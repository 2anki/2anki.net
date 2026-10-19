import { describe, it, expect, vi } from 'vitest';
import {
  AD_CLICK_COOKIE,
  buildAdClickCookie,
  captureAdClick,
  hasMarketingConsent,
  landingViewProps,
  readAdClickParams,
  readCampaignParams,
} from './adClick';

const CONSENT = 'cookie_consent=granted';

function decodeCookieValue(assignment: string): unknown {
  const value = assignment.split(';')[0].slice(`${AD_CLICK_COOKIE}=`.length);
  return JSON.parse(decodeURIComponent(value));
}

function existingClick(params: Record<string, string>): string {
  return `${AD_CLICK_COOKIE}=${encodeURIComponent(JSON.stringify(params))}`;
}

describe('readAdClickParams', () => {
  it('keeps only the Google click ids and utm fields', () => {
    expect(
      readAdClickParams(
        '?gclid=Cj0abc&utm_source=google&utm_campaign=notion&foo=bar&wbraid=w1'
      )
    ).toEqual({
      gclid: 'Cj0abc',
      wbraid: 'w1',
      utm_source: 'google',
      utm_campaign: 'notion',
    });
  });

  it('returns null when no attribution parameter is present', () => {
    expect(readAdClickParams('?ref=upload-limit-wall')).toBeNull();
    expect(readAdClickParams('')).toBeNull();
  });

  it('applies the server rules: empty, oversized or odd-charset values are dropped', () => {
    expect(
      readAdClickParams(
        `?gclid=&gbraid=has space&utm_source=${'x'.repeat(101)}&utm_medium=cpc&utm_term=<b>`
      )
    ).toEqual({ utm_medium: 'cpc' });
  });
});

describe('buildAdClickCookie', () => {
  it('stores the click parameters with the landing path for 90 days', () => {
    const cookie = buildAdClickCookie(
      '',
      '?gclid=Cj0abc&utm_source=google',
      '/notion-to-anki/',
      false
    );
    expect(cookie).not.toBeNull();
    expect(decodeCookieValue(cookie as string)).toEqual({
      gclid: 'Cj0abc',
      utm_source: 'google',
      landing: '/notion-to-anki/',
    });
    expect(cookie).toContain(`Max-Age=${90 * 24 * 60 * 60}`);
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Secure');
  });

  it('marks the cookie Secure on https', () => {
    const cookie = buildAdClickCookie('', '?gclid=1', '/', true);
    expect(cookie).toContain('; Secure');
  });

  it('stores only the public segments of the landing path', () => {
    for (const [path, stored] of [
      ['/s/share-token', '/s/'],
      ['/S/share-token', '/S/'],
      ['/preview/apkg/k', '/preview/'],
      ['/mindmaps/4821', '/mindmaps/'],
      ['/convert/word-to-anki/', '/convert/word-to-anki/'],
      ['/notion-to-anki', '/notion-to-anki/'],
    ]) {
      const cookie = buildAdClickCookie('', '?gclid=1', path, true);
      expect(decodeCookieValue(cookie as string)).toEqual({
        gclid: '1',
        landing: stored,
      });
    }
  });

  it('returns null when the URL carries no attribution', () => {
    expect(buildAdClickCookie('', '?page=2', '/pricing', false)).toBeNull();
  });

  it('lets a new Google click replace an older one (last click wins)', () => {
    const cookie = buildAdClickCookie(
      existingClick({ gclid: 'old' }),
      '?gclid=new',
      '/',
      true
    );
    expect(decodeCookieValue(cookie as string)).toEqual({
      gclid: 'new',
      landing: '/',
    });
  });

  it('does not let a plain utm link overwrite a stored Google click id', () => {
    expect(
      buildAdClickCookie(
        existingClick({ gclid: 'old' }),
        '?utm_source=newsletter',
        '/',
        true
      )
    ).toBeNull();
  });

  it('lets a utm link replace a stored utm-only click', () => {
    const cookie = buildAdClickCookie(
      existingClick({ utm_source: 'old' }),
      '?utm_source=newsletter',
      '/',
      true
    );
    expect(decodeCookieValue(cookie as string)).toEqual({
      utm_source: 'newsletter',
      landing: '/',
    });
  });
});

describe('hasMarketingConsent', () => {
  it('is true only for cookie_consent=granted', () => {
    expect(hasMarketingConsent(`a=1; ${CONSENT}; b=2`)).toBe(true);
    expect(hasMarketingConsent('cookie_consent=denied')).toBe(false);
    expect(hasMarketingConsent('')).toBe(false);
  });
});

describe('captureAdClick', () => {
  it('writes the cookie when landing from an ad click with consent granted', () => {
    const doc = {
      cookie: CONSENT,
      location: {
        pathname: '/pdf-to-anki/',
        search: '?gbraid=g1&utm_source=google&utm_medium=cpc',
        protocol: 'https:',
      },
    };
    captureAdClick(doc);
    expect(decodeCookieValue(doc.cookie)).toEqual({
      gbraid: 'g1',
      utm_source: 'google',
      utm_medium: 'cpc',
      landing: '/pdf-to-anki/',
    });
  });

  it('writes nothing without marketing consent', () => {
    const doc = {
      cookie: '',
      location: { pathname: '/', search: '?gclid=new', protocol: 'https:' },
    };
    captureAdClick(doc);
    expect(doc.cookie).toBe('');
  });

  it('leaves the cookie alone on a visit without click parameters', () => {
    const existing = `${CONSENT}; ${existingClick({ gclid: 'old' })}`;
    const doc = {
      cookie: existing,
      location: { pathname: '/upload', search: '', protocol: 'https:' },
    };
    captureAdClick(doc);
    expect(doc.cookie).toBe(existing);
  });

  it('writes without a consent cookie when the server placed the visitor outside the EEA', () => {
    const doc = {
      cookie: '',
      documentElement: { dataset: { consentRegion: 'other' } },
      location: { pathname: '/', search: '?gclid=us1', protocol: 'https:' },
    };
    captureAdClick(doc);
    expect(decodeCookieValue(doc.cookie)).toEqual({
      gclid: 'us1',
      landing: '/',
    });
  });

  it('respects an explicit deny even outside the EEA', () => {
    const doc = {
      cookie: 'cookie_consent=denied',
      documentElement: { dataset: { consentRegion: 'other' } },
      location: { pathname: '/', search: '?gclid=us1', protocol: 'https:' },
    };
    captureAdClick(doc);
    expect(doc.cookie).toBe('cookie_consent=denied');
  });
});

describe('readCampaignParams', () => {
  it('keeps the campaign tags and drops click ids and utm_content', () => {
    expect(
      readCampaignParams(
        '?utm_source=google&utm_medium=cpc&utm_campaign=ai&utm_term=anki+ai&utm_content=ad1&gclid=Cj0'
      )
    ).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'ai',
      utm_term: 'anki ai',
    });
  });

  it('drops a tag that fails the server pattern', () => {
    expect(readCampaignParams('?utm_campaign=%3Cscript%3E')).toEqual({});
  });
});

describe('landingViewProps', () => {
  it('adds the campaign tags in the URL to the landing path', () => {
    vi.stubGlobal('location', { search: '?utm_campaign=pdf' });
    expect(landingViewProps('/pdf-to-anki')).toEqual({
      path: '/pdf-to-anki',
      utm_campaign: 'pdf',
    });
    vi.unstubAllGlobals();
  });
});
