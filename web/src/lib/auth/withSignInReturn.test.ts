import { describe, expect, it } from 'vitest';
import { withSignInReturn } from './withSignInReturn';

describe('withSignInReturn', () => {
  it('adds a relative return target, encoded', () => {
    expect(
      withSignInReturn('/api/users/auth/google/init', '/pricing?ref=mcp')
    ).toBe('/api/users/auth/google/init?redirect=%2Fpricing%3Fref%3Dmcp');
  });

  it.each([null, undefined, '', 'https://evil.com', '//evil.com', '/\\evil'])(
    'leaves the sign-in URL as it is for %s',
    (redirect) => {
      expect(withSignInReturn('/api/users/auth/google/init', redirect)).toBe(
        '/api/users/auth/google/init'
      );
    }
  );
});
