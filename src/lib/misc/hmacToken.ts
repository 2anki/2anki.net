import crypto from 'node:crypto';

// Deterministic keyed hash for values that must be looked up again later
// (claim-token hashes, rate-limit IP hashes). hashToken() is AES encryption
// with a random salt — two calls on the same input never match, so it can
// only ever serve as a one-way log surrogate, never as a lookup key.
export default function hmacToken(value: string): string {
  return crypto
    .createHmac('sha256', process.env.THE_HASHING_SECRET!)
    .update(value)
    .digest('hex');
}
