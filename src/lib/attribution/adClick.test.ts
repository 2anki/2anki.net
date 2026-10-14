import { describe, it, expect } from 'vitest';
import { adClickEventProps, parseAdClick, readAdClickCookie } from './adClick';

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

  it('keeps only a plain public path for landing', () => {
    expect(parseAdClick(cookie({ landing: 'https://evil.example/' }))).toEqual(
      {}
    );
    expect(parseAdClick(cookie({ landing: '//evil.example/' }))).toEqual({});
    expect(parseAdClick(cookie({ landing: '/s/secret-share-token' }))).toEqual(
      {}
    );
    expect(parseAdClick(cookie({ landing: '/preview/apkg/key123' }))).toEqual(
      {}
    );
    expect(parseAdClick(cookie({ landing: '/convert/word-to-anki/' }))).toEqual(
      { landing: '/convert/word-to-anki/' }
    );
  });
});

describe('readAdClickCookie', () => {
  it('reads the ad_click cookie off an express request', () => {
    const req = { cookies: { ad_click: cookie({ gclid: 'abc' }) } } as never;
    expect(readAdClickCookie(req)).toEqual({ gclid: 'abc' });
  });

  it('returns undefined when there is no usable cookie', () => {
    expect(readAdClickCookie({} as never)).toBeUndefined();
    expect(readAdClickCookie({ cookies: { ad_click: '{}' } })).toBeUndefined();
  });
});

describe('adClickEventProps', () => {
  it('keeps the click ids and campaign keys, drops utm_term, utm_content and landing', () => {
    expect(
      adClickEventProps({
        gclid: 'a',
        gbraid: 'b',
        wbraid: 'c',
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'notion',
        utm_term: 'pdf to anki',
        utm_content: 'rsa-1',
        landing: '/pdf-to-anki/',
      })
    ).toEqual({
      gclid: 'a',
      gbraid: 'b',
      wbraid: 'c',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'notion',
    });
  });
});
