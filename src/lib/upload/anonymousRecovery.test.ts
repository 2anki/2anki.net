import {
  ANON_RECOVERY_PREFIX,
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
