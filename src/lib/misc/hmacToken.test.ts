import hmacToken from './hmacToken';
import hashToken from './hashToken';

process.env.THE_HASHING_SECRET = 'test-secret-for-jest';

describe('hmacToken', () => {
  it('is deterministic — the same input always produces the same digest', () => {
    expect(hmacToken('claim-token')).toBe(hmacToken('claim-token'));
  });

  it('produces different digests for different inputs', () => {
    expect(hmacToken('a')).not.toBe(hmacToken('b'));
  });

  it('produces a 64-char hex sha256 digest', () => {
    expect(hmacToken('claim-token')).toMatch(/^[0-9a-f]{64}$/);
  });

  // The claim flows must never go back to hashToken for lookup keys: it is
  // AES encryption with a random salt, so two calls on the same input never
  // match and every stored-hash lookup misses.
  it('documents why hashToken cannot serve as a lookup key', () => {
    expect(hashToken('claim-token')).not.toBe(hashToken('claim-token'));
  });
});
