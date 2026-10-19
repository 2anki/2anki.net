import crypto from 'node:crypto';
import express from 'express';

export function resolveClientIp(req: express.Request): string {
  // req.ip is set by Express when 'trust proxy' is configured; it respects the
  // trust setting and ignores attacker-prepended X-Forwarded-For hops. Fall
  // back to the raw header + socket address for tests and for hypothetical
  // call sites where trust proxy isn't on the app instance.
  if (typeof req.ip === 'string' && req.ip.length > 0) {
    return req.ip;
  }
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0].trim();
    if (first.length > 0) return first;
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

export function hashIp(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

const HEXTET = /^[0-9a-f]{1,4}$/i;

function toFullHextets(ip: string): number[] | null {
  const noZone = ip.split('%')[0];
  if (!noZone.includes(':')) {
    return null;
  }
  if (noZone.indexOf('::') !== noZone.lastIndexOf('::')) {
    return null;
  }
  let normalized = noZone;
  const dotIndex = normalized.indexOf('.');
  if (dotIndex !== -1) {
    const lastColon = normalized.lastIndexOf(':');
    const octets = normalized
      .slice(lastColon + 1)
      .split('.')
      .map(Number);
    if (
      octets.length !== 4 ||
      octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    ) {
      return null;
    }
    const high = (octets[0] << 8) | octets[1];
    const low = (octets[2] << 8) | octets[3];
    normalized = `${normalized.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }
  const doubleColon = normalized.indexOf('::');
  let groups: string[];
  if (doubleColon === -1) {
    groups = normalized.split(':');
  } else {
    const left = normalized.slice(0, doubleColon).split(':').filter(Boolean);
    const right = normalized
      .slice(doubleColon + 2)
      .split(':')
      .filter(Boolean);
    const missing = 8 - (left.length + right.length);
    if (missing < 0) {
      return null;
    }
    groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  }
  if (groups.length !== 8 || groups.some((group) => !HEXTET.test(group))) {
    return null;
  }
  return groups.map((group) => parseInt(group, 16));
}

// A single IPv6 /64 or NAT64 prefix can mint unlimited addresses, so rate
// limiting on the full address is trivially defeated. Bucket IPv6 by its /64
// prefix, and collapse an IPv4-mapped IPv6 address back to the IPv4 it carries
// so both forms of the same client share one bucket. IPv4 and anything that
// does not parse pass through unchanged.
export function ipRateLimitBucket(raw: string): string {
  const ip = (raw ?? '').trim();
  if (ip.length === 0) {
    return 'unknown';
  }
  const hextets = toFullHextets(ip);
  if (hextets == null) {
    return ip;
  }
  const isIpv4Mapped =
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0xffff;
  if (isIpv4Mapped) {
    return [
      hextets[6] >> 8,
      hextets[6] & 0xff,
      hextets[7] >> 8,
      hextets[7] & 0xff,
    ].join('.');
  }
  return `${hextets
    .slice(0, 4)
    .map((n) => n.toString(16))
    .join(':')}::/64`;
}
