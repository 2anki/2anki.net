import { describe, expect, it } from 'vitest';
import { withSignInReturn } from './withSignInReturn';

describe('withSignInReturn', () => {
  it('adds a relative return target, encoded', () => {
    expect(
      withSignInReturn('/api/users/auth/google/init', '/pricing?ref=mcp')
    ).toBe('/api/users/auth/google/init?redirect=%2Fpricing%3Fref%3Dmcp');
  });

  it('carries the connector link context to the provider return', () => {
    const target = '/pricing?ref=mcp&k=partial&a=b&held_until=2026-11-25';
    const url = withSignInReturn('/api/users/auth/google/init', target);

    expect(new URL(url, 'https://2anki.net').searchParams.get('redirect')).toBe(
      target
    );
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
