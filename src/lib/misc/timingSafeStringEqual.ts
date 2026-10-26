import crypto from 'node:crypto';

// Constant-time equality for secrets of any length. Hashing both sides to a
// fixed 32-byte digest first means timingSafeEqual never sees unequal-length
// buffers (which would throw) and the comparison leaks neither the content nor
// the length of the expected value.
export function timingSafeStringEqual(a: string, b: string): boolean {
  const aDigest = crypto.createHash('sha256').update(a, 'utf8').digest();
  const bDigest = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(aDigest, bDigest);
}
