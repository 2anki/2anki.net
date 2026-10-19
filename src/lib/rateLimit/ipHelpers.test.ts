import crypto from 'node:crypto';
import express from 'express';
import { resolveClientIp, hashIp, ipRateLimitBucket } from './ipHelpers';

function makeReq(
  headers: Record<string, unknown>,
  remoteAddress?: string,
  ip?: string
): express.Request {
  return {
    ip,
    headers,
    socket: { remoteAddress },
  } as unknown as express.Request;
}

describe('resolveClientIp', () => {
  it('prefers req.ip and ignores a conflicting x-forwarded-for', () => {
    const req = makeReq(
      { 'x-forwarded-for': '1.2.3.4' },
      '10.0.0.1',
      '203.0.113.7'
    );
    expect(resolveClientIp(req)).toBe('203.0.113.7');
  });

  it('returns the x-forwarded-for value when present', () => {
    const req = makeReq({ 'x-forwarded-for': '203.0.113.7' }, '10.0.0.1');
    expect(resolveClientIp(req)).toBe('203.0.113.7');
  });

  it('returns the first hop of a comma-separated x-forwarded-for', () => {
    const req = makeReq(
      { 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' },
      '10.0.0.1'
    );
    expect(resolveClientIp(req)).toBe('203.0.113.7');
  });

  it('trims whitespace around the first hop', () => {
    const req = makeReq({ 'x-forwarded-for': '  203.0.113.7 , 70.41.3.18' });
    expect(resolveClientIp(req)).toBe('203.0.113.7');
  });

  it('falls back to socket.remoteAddress when x-forwarded-for is missing', () => {
    const req = makeReq({}, '198.51.100.4');
    expect(resolveClientIp(req)).toBe('198.51.100.4');
  });

  it("returns 'unknown' when neither header nor remoteAddress is present", () => {
    const req = makeReq({});
    expect(resolveClientIp(req)).toBe('unknown');
  });

  it('tolerates a req with no headers property and falls back', () => {
    const req = {
      socket: { remoteAddress: '198.51.100.9' },
    } as unknown as express.Request;
    expect(resolveClientIp(req)).toBe('198.51.100.9');
  });

  it("returns 'unknown' for a req with neither headers nor socket", () => {
    const req = {} as unknown as express.Request;
    expect(resolveClientIp(req)).toBe('unknown');
  });
});

describe('hashIp', () => {
  it('produces a 64-character hex sha256 digest', () => {
    const digest = hashIp('203.0.113.7');
    expect(digest).toHaveLength(64);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(hashIp('203.0.113.7')).toBe(hashIp('203.0.113.7'));
  });

  it('matches a direct sha256 hex computation', () => {
    const expected = crypto
      .createHash('sha256')
      .update('203.0.113.7')
      .digest('hex');
    expect(hashIp('203.0.113.7')).toBe(expected);
  });

  it('produces different digests for different inputs', () => {
    expect(hashIp('203.0.113.7')).not.toBe(hashIp('203.0.113.8'));
  });
});

describe('ipRateLimitBucket', () => {
  it('passes an IPv4 address through unchanged', () => {
    expect(ipRateLimitBucket('203.0.113.7')).toBe('203.0.113.7');
  });

  it('buckets an IPv6 address by its /64 prefix', () => {
    expect(ipRateLimitBucket('2001:db8:1234:5678:9abc:def0:1234:5678')).toBe(
      '2001:db8:1234:5678::/64'
    );
  });

  it('puts two addresses in the same /64 into one bucket', () => {
    expect(ipRateLimitBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe(
      ipRateLimitBucket('2001:db8:1:2:1111:2222:3333:4444')
    );
  });

  it('separates addresses from different /64 prefixes', () => {
    expect(ipRateLimitBucket('2001:db8:1:2::1')).not.toBe(
      ipRateLimitBucket('2001:db8:1:3::1')
    );
  });

  it('expands a compressed IPv6 address before taking the prefix', () => {
    expect(ipRateLimitBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });

  it('collapses a dotted IPv4-mapped IPv6 address to the IPv4', () => {
    expect(ipRateLimitBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('collapses a hex IPv4-mapped IPv6 address to the same IPv4', () => {
    expect(ipRateLimitBucket('::ffff:cb00:7107')).toBe('203.0.113.7');
  });

  it('strips an IPv6 zone id before bucketing', () => {
    expect(ipRateLimitBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it("returns 'unknown' for an empty input", () => {
    expect(ipRateLimitBucket('')).toBe('unknown');
  });

  it('passes a non-IP string through unchanged', () => {
    expect(ipRateLimitBucket('unknown')).toBe('unknown');
  });

  it('passes a malformed address with two :: groups through unchanged', () => {
    expect(ipRateLimitBucket('2001::db8::1')).toBe('2001::db8::1');
  });

  it('passes an address with a non-hex group through unchanged', () => {
    expect(ipRateLimitBucket('2001:db8:zz:2:3:4:5:6')).toBe(
      '2001:db8:zz:2:3:4:5:6'
    );
  });
});
