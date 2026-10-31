import crypto from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';

export const GOOGLE_STATE_COOKIE = 'google_login_state';
export const MICROSOFT_STATE_COOKIE = 'microsoft_login_state';
export const NOTION_STATE_COOKIE = 'notion_login_state';
export const NOTION_LOGIN_STATE_PREFIX = 'login:';
export const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

// SameSite=Lax is enough here, and only here: Google and Microsoft both come
// back by a top-level GET (Microsoft is asked for response_mode=query), which
// carries a Lax cookie. A form_post provider (Apple) needs SameSite=None.
const stateCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
});

export function startOAuthSignIn(
  res: Response,
  cookieName: string,
  signInUrl: (state: string) => string | null
): string | null {
  const state = crypto.randomUUID();
  const url = signInUrl(state);
  if (url == null) {
    return null;
  }
  res.cookie(cookieName, state, {
    ...stateCookieOptions(),
    maxAge: OAUTH_STATE_MAX_AGE_MS,
  });
  return url;
}

function sameState(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length &&
    crypto.timingSafeEqual(expectedBytes, receivedBytes)
  );
}

export function isNotionLoginState(state: unknown): state is string {
  return (
    typeof state === 'string' && state.startsWith(NOTION_LOGIN_STATE_PREFIX)
  );
}

export function notionLoginNonce(state: unknown): string | undefined {
  return isNotionLoginState(state)
    ? state.slice(NOTION_LOGIN_STATE_PREFIX.length)
    : undefined;
}

export function takeOAuthState(
  req: Request,
  res: Response,
  cookieName: string,
  received: unknown
): boolean {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const expected = cookies?.[cookieName];
  res.clearCookie(cookieName, stateCookieOptions());
  if (
    typeof expected !== 'string' ||
    expected === '' ||
    typeof received !== 'string'
  ) {
    return false;
  }
  return sameState(expected, received);
}
