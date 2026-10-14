import { describe, it, expect } from 'vitest';
import {
  AD_CLICK_COOKIE,
  buildAdClickCookie,
  captureAdClick,
  readAdClickParams,
} from './adClick';

function decodeCookieValue(assignment: string): unknown {
  const value = assignment.split(';')[0].slice(`${AD_CLICK_COOKIE}=`.length);
  return JSON.parse(decodeURIComponent(value));
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

  it('drops empty and oversized values', () => {
    expect(
      readAdClickParams(`?gclid=&utm_source=${'x'.repeat(300)}&utm_medium=cpc`)
    ).toEqual({ utm_medium: 'cpc' });
  });
});

describe('buildAdClickCookie', () => {
  it('stores the click parameters with the landing path for 90 days', () => {
    const cookie = buildAdClickCookie(
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
    const cookie = buildAdClickCookie('?gclid=1', '/', true);
    expect(cookie).toContain('; Secure');
  });

  it('returns null when the URL carries no attribution (existing cookie kept)', () => {
    expect(buildAdClickCookie('?page=2', '/pricing', false)).toBeNull();
  });
});

describe('captureAdClick', () => {
  it('writes the cookie when landing from an ad click', () => {
    const doc = {
      cookie: '',
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

  it('overwrites an older click with the newest one (last click wins)', () => {
    const doc = {
      cookie: `${AD_CLICK_COOKIE}=%7B%22gclid%22%3A%22old%22%7D`,
      location: { pathname: '/', search: '?gclid=new', protocol: 'https:' },
    };
    captureAdClick(doc);
    expect(decodeCookieValue(doc.cookie)).toEqual({
      gclid: 'new',
      landing: '/',
    });
  });

  it('leaves the cookie alone on a visit without click parameters', () => {
    const existing = `${AD_CLICK_COOKIE}=%7B%22gclid%22%3A%22old%22%7D`;
    const doc = {
      cookie: existing,
      location: { pathname: '/upload', search: '', protocol: 'https:' },
    };
    captureAdClick(doc);
    expect(doc.cookie).toBe(existing);
  });
});
