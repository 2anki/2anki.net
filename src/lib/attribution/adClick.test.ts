import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  adClickEventProps,
  parseAdClick,
  readAdClickCookie,
  readCheckoutAttribution,
} from './adClick';
import { consentRegionForRequest } from '../http/consentRegion';

vi.mock('../http/consentRegion', () => ({
  consentRegionForRequest: vi.fn(() => 'eea'),
}));

const cookie = (value: unknown) => encodeURIComponent(JSON.stringify(value));

describe('parseAdClick', () => {
  it('returns the allowed click fields from a well-formed cookie', () => {
    expect(
      parseAdClick(
        cookie({
          gclid: 'Cj0KCQjw-abc_DEF123',
          utm_source: 'Google',
          utm_campaign: 'notion to anki',
          landing: '/notion-to-anki/',
        })
      )
    ).toEqual({
      gclid: 'Cj0KCQjw-abc_DEF123',
      utm_source: 'google',
      utm_campaign: 'notion to anki',
      landing: '/notion-to-anki/',
    });
  });

  it('accepts a raw (not URL-encoded) JSON string too', () => {
    expect(parseAdClick('{"wbraid":"w-1"}')).toEqual({ wbraid: 'w-1' });
  });

  it('returns an empty object for missing, malformed or non-object input', () => {
    expect(parseAdClick(undefined)).toEqual({});
    expect(parseAdClick(42)).toEqual({});
    expect(parseAdClick('not json')).toEqual({});
    expect(parseAdClick('%7B%7D%7D')).toEqual({});
    expect(parseAdClick(cookie('string'))).toEqual({});
    expect(parseAdClick(cookie(['gclid']))).toEqual({});
  });

  it('drops unknown keys, prototype names and non-string values', () => {
    const raw =
      '{"gclid":"ok","toString":"x","__proto__":{"polluted":"1"},"constructor":{"prototype":{"x":1}},"fbclid":"nope","utm_term":7}';
    const result = parseAdClick(raw);
    expect(result).toEqual({ gclid: 'ok' });
    expect(result).not.toHaveProperty('polluted');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects click ids with characters outside [A-Za-z0-9_-] and oversize values', () => {
    expect(
      parseAdClick(
        cookie({
          gclid: 'has space',
          gbraid: 'semi;colon',
          wbraid: 'x'.repeat(201),
          utm_source: 'google',
        })
      )
    ).toEqual({ utm_source: 'google' });
  });

  it('rejects utm values with control or markup characters and oversize values', () => {
    expect(
      parseAdClick(
        cookie({
          utm_source: '<script>',
          utm_medium: 'cpc\n',
          utm_content: 'x'.repeat(101),
          utm_term: 'pdf to anki',
        })
      )
    ).toEqual({ utm_term: 'pdf to anki' });
  });

  it('keeps only the public segments of the landing path', () => {
    expect(parseAdClick(cookie({ landing: 'https://evil.example/' }))).toEqual(
      {}
    );
    expect(parseAdClick(cookie({ landing: '//evil.example/' }))).toEqual({});
    expect(parseAdClick(cookie({ landing: '/' }))).toEqual({ landing: '/' });
    expect(parseAdClick(cookie({ landing: '/notion-to-anki' }))).toEqual({
      landing: '/notion-to-anki/',
    });
    expect(parseAdClick(cookie({ landing: '/convert/word-to-anki/' }))).toEqual(
      { landing: '/convert/word-to-anki/' }
    );
    expect(
      parseAdClick(cookie({ landing: '/answers/chatgpt-to-anki/' }))
    ).toEqual({ landing: '/answers/chatgpt-to-anki/' });
  });

  it.each([
    ['/s/secret-share-token', '/s/'],
    ['/S/secret-share-token', '/S/'],
    ['/preview/apkg/key123', '/preview/'],
    ['/mindmaps/4821', '/mindmaps/'],
    ['/users/r/77', '/users/'],
    ['/convert/word-to-anki/extra/42', '/convert/word-to-anki/'],
  ])('never stores the id or token in %s', (input, stored) => {
    const parsed = parseAdClick(cookie({ landing: input }));
    expect(parsed.landing).toBe(stored);
    expect(parsed.landing).not.toContain('42');
    expect(parsed.landing).not.toContain('token');
  });
});

describe('readAdClickCookie', () => {
  it('reads the ad_click cookie off an express request when consent is granted', () => {
    const req = {
      cookies: {
        cookie_consent: 'granted',
        ad_click: cookie({ gclid: 'abc' }),
      },
    } as never;
    expect(readAdClickCookie(req)).toEqual({ gclid: 'abc' });
  });

  it('returns undefined when there is no usable cookie', () => {
    expect(readAdClickCookie({} as never)).toBeUndefined();
    expect(
      readAdClickCookie({
        cookies: { cookie_consent: 'granted', ad_click: '{}' },
      } as never)
    ).toBeUndefined();
  });

  it('ignores a stored ad_click cookie once consent is withdrawn, or absent in the EEA', () => {
    expect(
      readAdClickCookie({
        cookies: {
          cookie_consent: 'denied',
          ad_click: cookie({ gclid: 'abc' }),
        },
      } as never)
    ).toBeUndefined();
    expect(
      readAdClickCookie({
        cookies: { ad_click: cookie({ gclid: 'abc' }) },
      } as never)
    ).toBeUndefined();
  });

  it('accepts ad_click without a consent cookie where consent is implied by region', () => {
    vi.mocked(consentRegionForRequest).mockReturnValueOnce('other');
    expect(
      readAdClickCookie({
        cookies: { ad_click: cookie({ gclid: 'abc' }) },
      } as never)
    ).toEqual({ gclid: 'abc' });
  });

  it('still drops an explicit deny outside the EEA', () => {
    vi.mocked(consentRegionForRequest).mockReturnValueOnce('other');
    expect(
      readAdClickCookie({
        cookies: {
          cookie_consent: 'denied',
          ad_click: cookie({ gclid: 'abc' }),
        },
      } as never)
    ).toBeUndefined();
  });
});

describe('readCheckoutAttribution', () => {
  beforeEach(() => {
    vi.mocked(consentRegionForRequest).mockReset().mockReturnValue('eea');
  });

  it('lets the consented ad_click cookie win a tag both carry', () => {
    const req = {
      cookies: {
        cookie_consent: 'granted',
        ad_click: cookie({ gclid: 'abc', utm_campaign: 'cookie' }),
      },
      body: { campaign: { utm_campaign: 'body' } },
    } as never;
    expect(readCheckoutAttribution(req)).toEqual({
      gclid: 'abc',
      utm_campaign: 'cookie',
    });
  });

  it("keeps this visit's campaign tags when the cookie holds only a click id", () => {
    const req = {
      cookies: {
        cookie_consent: 'granted',
        ad_click: cookie({ gclid: 'abc' }),
      },
      body: { campaign: { utm_campaign: 'ai-search' } },
    } as never;
    expect(readCheckoutAttribution(req)).toEqual({
      gclid: 'abc',
      utm_campaign: 'ai-search',
    });
  });

  it('falls back to the campaign tags the page sent when there is no consent', () => {
    const req = {
      cookies: { ad_click: cookie({ gclid: 'abc' }) },
      body: {
        campaign: {
          utm_source: 'Google',
          utm_medium: 'cpc',
          utm_campaign: 'ai-search',
          utm_term: 'anki ai',
        },
      },
    } as never;
    expect(readCheckoutAttribution(req)).toEqual({
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'ai-search',
      utm_term: 'anki ai',
    });
  });

  it('never takes click ids, the landing path or utm_content from the body', () => {
    const req = {
      body: {
        campaign: {
          gclid: 'abc',
          gbraid: 'def',
          landing: '/pricing',
          utm_content: 'ad-1',
          utm_campaign: 'brand',
        },
      },
    } as never;
    expect(readCheckoutAttribution(req)).toEqual({ utm_campaign: 'brand' });
  });

  it.each([
    ['no body', {}],
    ['a string campaign', { body: { campaign: 'utm_campaign=x' } }],
    ['an array campaign', { body: { campaign: ['x'] } }],
    ['an invalid value', { body: { campaign: { utm_campaign: '<script>' } } }],
    [
      'an inherited key',
      { body: { campaign: Object.create({ utm_campaign: 'proto' }) } },
    ],
  ])('returns undefined for %s', (_label, req) => {
    expect(readCheckoutAttribution(req as never)).toBeUndefined();
  });
});
