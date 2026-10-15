import type express from 'express';
import {
  parseGaClientId,
  parseGaSessionId,
  readGaMeasurement,
} from './gaClientId';

describe('parseGaClientId', () => {
  it('extracts the client_id from a standard _ga cookie', () => {
    expect(parseGaClientId('GA1.1.1234567890.987654321')).toBe(
      '1234567890.987654321'
    );
  });

  it('handles other version/scope prefixes', () => {
    expect(parseGaClientId('GA1.2.555.666')).toBe('555.666');
    expect(parseGaClientId('GA2.10.42.99')).toBe('42.99');
  });

  it('returns undefined for a value missing the client_id pair', () => {
    expect(parseGaClientId('GA1.1.1234567890')).toBeUndefined();
    expect(parseGaClientId('GA1.1.')).toBeUndefined();
  });

  it('returns undefined for arbitrary or malformed input', () => {
    expect(parseGaClientId('not-a-cookie')).toBeUndefined();
    expect(parseGaClientId('GA1.1.abc.def')).toBeUndefined();
    expect(parseGaClientId('1234567890.987654321')).toBeUndefined();
  });

  it('returns undefined for empty or non-string input', () => {
    expect(parseGaClientId('')).toBeUndefined();
    expect(parseGaClientId(undefined)).toBeUndefined();
    expect(parseGaClientId(null)).toBeUndefined();
    expect(parseGaClientId(42)).toBeUndefined();
  });
});

describe('parseGaSessionId', () => {
  it('extracts the session id from the legacy GS1.1 cookie format', () => {
    expect(parseGaSessionId('GS1.1.1744000000.5.1.1744000100.0.0.0')).toBe(
      '1744000000'
    );
  });

  it('extracts the session id from the newer GS2.1.s... cookie format', () => {
    expect(
      parseGaSessionId('GS2.1.s1744000000$o5$g1$t1744000100$j60$l0$h0')
    ).toBe('1744000000');
  });

  it('returns undefined for a malformed or non-digit session segment', () => {
    expect(parseGaSessionId('GS1.1.abcdef.5.1')).toBeUndefined();
    expect(parseGaSessionId('GS2.1.sabc$o5')).toBeUndefined();
    expect(parseGaSessionId('not-a-cookie')).toBeUndefined();
  });

  it('rejects an over-long digit run', () => {
    expect(parseGaSessionId(`GS1.1.${'9'.repeat(30)}.5`)).toBeUndefined();
  });

  it('returns undefined for empty or non-string input', () => {
    expect(parseGaSessionId('')).toBeUndefined();
    expect(parseGaSessionId(undefined)).toBeUndefined();
    expect(parseGaSessionId(null)).toBeUndefined();
    expect(parseGaSessionId(42)).toBeUndefined();
  });
});

describe('readGaMeasurement', () => {
  function makeReq(cookies: Record<string, unknown>): express.Request {
    return { cookies } as unknown as express.Request;
  }

  it('returns the client id and session id when tracking is allowed', () => {
    const req = makeReq({
      cookie_consent: 'granted',
      _ga: 'GA1.1.1234567890.987654321',
      _ga_X6K69TY3EX: 'GS1.1.1744000000.5.1.1744000100.0.0.0',
    });
    expect(readGaMeasurement(req)).toEqual({
      gaClientId: '1234567890.987654321',
      gaSessionId: '1744000000',
    });
  });

  it('returns an empty object when neither GA cookie is present', () => {
    expect(readGaMeasurement(makeReq({ anon_id: 'x' }))).toEqual({});
  });

  it('returns an empty object when consent is denied', () => {
    const req = makeReq({
      cookie_consent: 'denied',
      _ga: 'GA1.1.1234567890.987654321',
      _ga_X6K69TY3EX: 'GS1.1.1744000000.5.1.1744000100.0.0.0',
    });
    expect(readGaMeasurement(req)).toEqual({});
  });

  it('omits the session id when only the _ga cookie is present', () => {
    const req = makeReq({
      cookie_consent: 'granted',
      _ga: 'GA1.1.1234567890.987654321',
    });
    expect(readGaMeasurement(req)).toEqual({
      gaClientId: '1234567890.987654321',
    });
  });
});
