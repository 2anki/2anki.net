import { vi } from 'vitest';
import { normalizeRelease, resolveRelease } from './release';

const FULL_SHA = 'dc017dfee6f6a1b2c3d4e5f60718293a4b5c6d7e';

describe('normalizeRelease', () => {
  it('returns null for undefined', () => {
    expect(normalizeRelease(undefined)).toBeNull();
  });

  it('returns null for empty and whitespace-only strings', () => {
    expect(normalizeRelease('')).toBeNull();
    expect(normalizeRelease('   ')).toBeNull();
  });

  it('shortens a full 40-char sha to 7 chars', () => {
    expect(normalizeRelease(FULL_SHA)).toBe('dc017df');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeRelease('  abc1234\n')).toBe('abc1234');
  });

  it('caps non-sha values at 64 chars to fit the column', () => {
    const long = 'x'.repeat(80);
    expect(normalizeRelease(long)).toBe('x'.repeat(64));
  });

  it('keeps a full TrunkVer intact (timestamp.0.0-g<sha>-<buildref>)', () => {
    const trunkver = '20260619125336.0.0-g4579478f93dc-20652898919-1';
    expect(normalizeRelease(trunkver)).toBe(trunkver);
  });
});

describe('resolveRelease', () => {
  it('prefers RELEASE over GIT_SHA and git lookup', () => {
    const readGitSha = vi.fn(() => 'fff0000');
    const release = resolveRelease(
      { RELEASE: 'v1.2.3', GIT_SHA: FULL_SHA },
      readGitSha
    );
    expect(release).toBe('v1.2.3');
    expect(readGitSha).not.toHaveBeenCalled();
  });

  it('falls back to GIT_SHA when RELEASE is unset', () => {
    const readGitSha = vi.fn(() => 'fff0000');
    const release = resolveRelease({ GIT_SHA: FULL_SHA }, readGitSha);
    expect(release).toBe('dc017df');
    expect(readGitSha).not.toHaveBeenCalled();
  });

  it('falls back to git lookup when neither env var is set', () => {
    const release = resolveRelease({}, () => 'abc1234\n');
    expect(release).toBe('abc1234');
  });

  it('returns null when env vars are unset and git is unavailable', () => {
    expect(resolveRelease({}, () => null)).toBeNull();
  });
});
