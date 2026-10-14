import { describe, it, expect } from 'vitest';
import {
  AD_CLICK_COOKIE,
  buildAdClickCookie,
  captureAdClick,
  hasMarketingConsent,
  readAdClickParams,
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

  it('omits the landing path for share and preview routes', () => {
    const cookie = buildAdClickCookie('', '?gclid=1', '/s/share-token', true);
    expect(decodeCookieValue(cookie as string)).toEqual({ gclid: '1' });
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
});
