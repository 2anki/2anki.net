import { createHash } from 'node:crypto';
import {
  ANON_RECOVERY_PREFIX,
  anonPreviewCardsKey,
  anonRecoveryKey,
  isRecoveryToken,
  readRecoveryToken,
} from './anonymousRecovery';

const token = '3f2b8c1e-9a4d-4e7f-8b21-5c6d7e8f9a0b';

describe('isRecoveryToken', () => {
  it.each([
    [token, true],
    [token.toUpperCase(), true],
    ['', false],
    ['../../etc/passwd', false],
    [`${token}/x`, false],
    ['3f2b8c1e9a4d4e7f8b215c6d7e8f9a0b', false],
  ])('%p → %p', (value, expected) => {
    expect(isRecoveryToken(value)).toBe(expected);
  });

  it('rejects non-strings', () => {
    expect(isRecoveryToken(undefined)).toBe(false);
    expect(isRecoveryToken(['a'])).toBe(false);
  });
});

describe('anonRecoveryKey', () => {
  it('derives a hashed key under the reserved prefix', () => {
    expect(anonRecoveryKey('anon-1', token)).toMatch(
      /^recover\/[0-9a-f]{64}\.apkg$/
    );
    expect(ANON_RECOVERY_PREFIX).toBe('recover/');
  });

  it('is stable for the same visitor and token', () => {
    expect(anonRecoveryKey('anon-1', token)).toBe(
      anonRecoveryKey('anon-1', token)
    );
  });

  it('changes when either the visitor or the token changes', () => {
    const other = '00000000-0000-4000-8000-000000000000';
    expect(anonRecoveryKey('anon-2', token)).not.toBe(
      anonRecoveryKey('anon-1', token)
    );
    expect(anonRecoveryKey('anon-1', other)).not.toBe(
      anonRecoveryKey('anon-1', token)
    );
  });

  it('treats the token case-insensitively', () => {
    expect(anonRecoveryKey('anon-1', token.toUpperCase())).toBe(
      anonRecoveryKey('anon-1', token)
    );
  });
});

describe('anonPreviewCardsKey', () => {
  it('derives a hashed key under the reserved prefix, so the recovery sweeps cover it', () => {
    expect(anonPreviewCardsKey('anon-1', token)).toMatch(
      /^recover\/[0-9a-f]{64}\.apkg$/
    );
  });

  it('never matches the recovery key for the same visitor and token', () => {
    expect(anonPreviewCardsKey('anon-1', token)).not.toBe(
      anonRecoveryKey('anon-1', token)
    );
  });

  it('treats the token case-insensitively', () => {
    expect(anonPreviewCardsKey('anon-1', token.toUpperCase())).toBe(
      anonPreviewCardsKey('anon-1', token)
    );
  });

  it.each([
    ['preview-cards:anon-1', 'anon-1'],
    ['anon-1:preview-cards', 'anon-1'],
    [`anon-1:${token}:preview-cards`, 'anon-1'],
    ['preview-cards', ''],
  ])(
    'gives no anon id the recovery key of another visitor’s first cards (%s vs %s)',
    (craftedAnonId, victimAnonId) => {
      expect(anonRecoveryKey(craftedAnonId, token)).not.toBe(
        anonPreviewCardsKey(victimAnonId, token)
      );
    }
  );

  it('hashes the label after the token, where a recovery input can only hold a UUID', () => {
    const recoveryInput = `preview-cards:anon-1:${token}`;
    const previewInput = `anon-1:${token}:preview-cards`;
    expect(anonPreviewCardsKey('anon-1', token)).toBe(
      `recover/${createHash('sha256').update(previewInput).digest('hex')}.apkg`
    );
    expect(anonRecoveryKey('preview-cards:anon-1', token)).toBe(
      `recover/${createHash('sha256').update(recoveryInput).digest('hex')}.apkg`
    );
  });
});

describe('readRecoveryToken', () => {
  it('returns a valid header token', () => {
    expect(readRecoveryToken({ 'x-recovery-token': token })).toBe(token);
  });

  it.each([
    [{}],
    [{ 'x-recovery-token': 'nope' }],
    [{ 'x-recovery-token': [token] }],
  ])('returns null for %p', (headers) => {
    expect(readRecoveryToken(headers)).toBeNull();
  });
});
