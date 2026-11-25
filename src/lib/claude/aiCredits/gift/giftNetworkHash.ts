import type express from 'express';
import {
  ipRateLimitBucket,
  resolveClientIp,
} from '../../../rateLimit/ipHelpers';
import hmacToken from '../../../misc/hmacToken';

// The per-network grant limit counts grants per network, never by the raw
// address: the address is bucketed (IPv6 /64, IPv4 as is) and kept only as a
// keyed hash.
export function giftNetworkHash(req: express.Request): string {
  return hmacToken(ipRateLimitBucket(resolveClientIp(req)));
}
