import { vi } from 'vitest';
import type { Request, Response } from 'express';

import {
  GOOGLE_STATE_COOKIE,
  MICROSOFT_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_MS,
  isNotionLoginState,
  notionLoginNonce,
  startOAuthSignIn,
  takeOAuthState,
} from './oauthState';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fakeRes() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response & {
    cookie: ReturnType<typeof vi.fn>;
    clearCookie: ReturnType<typeof vi.fn>;
  };
}

function callbackRequest(cookies: Record<string, unknown>): Request {
  return { cookies } as unknown as Request;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('startOAuthSignIn', () => {
  const echoUrl = (state: string) =>
    `https://provider.test/auth?state=${state}`;

  it('puts a random UUID in the provider URL and in a ten-minute httpOnly Lax cookie', () => {
    const res = fakeRes();

    const url = startOAuthSignIn(res, GOOGLE_STATE_COOKIE, echoUrl);

    const state = new URL(url ?? '').searchParams.get('state');
    expect(state).toMatch(UUID_PATTERN);
    expect(res.cookie).toHaveBeenCalledWith(GOOGLE_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: OAUTH_STATE_MAX_AGE_MS,
    });
    expect(OAUTH_STATE_MAX_AGE_MS).toBe(10 * 60 * 1000);
  });

  it('marks the cookie Secure in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = fakeRes();

    startOAuthSignIn(res, MICROSOFT_STATE_COOKIE, echoUrl);

    expect(res.cookie).toHaveBeenCalledWith(
      MICROSOFT_STATE_COOKIE,
      expect.any(String),
      expect.objectContaining({ secure: true, sameSite: 'lax' })
    );
  });

  it('uses a different state on every start', () => {
    const res = fakeRes();

    const first = startOAuthSignIn(res, GOOGLE_STATE_COOKIE, echoUrl);
    const second = startOAuthSignIn(res, GOOGLE_STATE_COOKIE, echoUrl);

    expect(first).not.toBe(second);
  });

  it('sets no cookie and returns null when the provider is not configured', () => {
    const res = fakeRes();

    const url = startOAuthSignIn(res, GOOGLE_STATE_COOKIE, () => null);

    expect(url).toBeNull();
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe('takeOAuthState', () => {
  it('accepts the state that matches the cookie', () => {
    const res = fakeRes();

    const accepted = takeOAuthState(
      callbackRequest({ [GOOGLE_STATE_COOKIE]: 'abc-123' }),
      res,
      GOOGLE_STATE_COOKIE,
      'abc-123'
    );

    expect(accepted).toBe(true);
  });

  it.each([
    ['a different state', { [GOOGLE_STATE_COOKIE]: 'abc-123' }, 'abc-124'],
    ['a state of another length', { [GOOGLE_STATE_COOKIE]: 'abc-123' }, 'abc'],
    ['no state', { [GOOGLE_STATE_COOKIE]: 'abc-123' }, undefined],
    ['an empty state', { [GOOGLE_STATE_COOKIE]: 'abc-123' }, ''],
    ['an array of states', { [GOOGLE_STATE_COOKIE]: 'abc-123' }, ['abc-123']],
    ['no cookie', {}, 'abc-123'],
    ['an empty cookie and state', { [GOOGLE_STATE_COOKIE]: '' }, ''],
    [
      'the other provider cookie',
      { [MICROSOFT_STATE_COOKIE]: 'abc-123' },
      'abc-123',
    ],
  ])('refuses %s', (_label, cookies, received) => {
    const res = fakeRes();

    const accepted = takeOAuthState(
      callbackRequest(cookies),
      res,
      GOOGLE_STATE_COOKIE,
      received
    );

    expect(accepted).toBe(false);
  });

  it.each([
    ['a match', 'abc-123'],
    ['a mismatch', 'wrong'],
  ])('clears the cookie after %s', (_label, received) => {
    const res = fakeRes();

    takeOAuthState(
      callbackRequest({ [GOOGLE_STATE_COOKIE]: 'abc-123' }),
      res,
      GOOGLE_STATE_COOKIE,
      received
    );

    expect(res.clearCookie).toHaveBeenCalledWith(
      GOOGLE_STATE_COOKIE,
      expect.objectContaining({ httpOnly: true, path: '/' })
    );
  });

  it('tolerates a request with no parsed cookies', () => {
    const res = fakeRes();

    const accepted = takeOAuthState(
      {} as Request,
      res,
      GOOGLE_STATE_COOKIE,
      'abc-123'
    );

    expect(accepted).toBe(false);
  });
});

describe('Notion login state', () => {
  it.each([
    ['login:abc', true],
    ['login:', true],
    ['native:abc', false],
    ['abc', false],
    [undefined, false],
    [['login:abc'], false],
  ])('isNotionLoginState(%j) is %s', (state, expected) => {
    expect(isNotionLoginState(state)).toBe(expected);
  });

  it.each([
    ['login:abc', 'abc'],
    ['login:', ''],
    ['native:abc', undefined],
    [undefined, undefined],
  ])('notionLoginNonce(%j) is %j', (state, expected) => {
    expect(notionLoginNonce(state)).toBe(expected);
  });
});
