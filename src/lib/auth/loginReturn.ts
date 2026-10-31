import type { CookieOptions, Request, Response } from 'express';
import { resolveRedirect } from '../../controllers/helpers/getRedirect';
import { MCP_AUTHORIZE_PATH } from '../mcp/loginReturn';

export const LOGIN_RETURN_COOKIE = 'login_return';
export const LOGIN_RETURN_MAX_AGE_MS = 10 * 60 * 1000;

const MAX_REMEMBERED_LENGTH = 2048;

// SameSite=None (with Secure), as for the connector return cookie: Sign in
// with Apple comes back by a cross-site form POST, which never carries a Lax
// cookie. The value is only ever a same-origin path that getRedirect would
// also accept, so sending it cross-site leaks nothing and grants nothing.
const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  path: '/',
});

function isSameOriginPath(value: string): boolean {
  return (
    value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
  );
}

export function asLoginReturn(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value.length > MAX_REMEMBERED_LENGTH
  ) {
    return undefined;
  }
  const resolved = resolveRedirect(value);
  if (
    resolved == null ||
    !isSameOriginPath(resolved) ||
    resolved.startsWith(MCP_AUTHORIZE_PATH) ||
    encodeURIComponent(resolved).length > MAX_REMEMBERED_LENGTH
  ) {
    return undefined;
  }
  return resolved;
}

function hasLoginReturnCookie(req: Request): boolean {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  return cookies?.[LOGIN_RETURN_COOKIE] != null;
}

export function rememberLoginReturn(req: Request, res: Response): void {
  const safe = asLoginReturn(req.query?.redirect);
  if (safe == null) {
    return;
  }
  res.cookie(LOGIN_RETURN_COOKIE, safe, {
    ...cookieOptions(),
    maxAge: LOGIN_RETURN_MAX_AGE_MS,
  });
}

export function takeLoginReturn(
  req: Request,
  res: Response
): string | undefined {
  if (!hasLoginReturnCookie(req)) {
    return undefined;
  }
  const cookies = req.cookies as Record<string, unknown>;
  res.clearCookie(LOGIN_RETURN_COOKIE, cookieOptions());
  return asLoginReturn(cookies[LOGIN_RETURN_COOKIE]);
}

function sectionOf(path: string): string {
  return path.slice(1).split(/[/?#]/, 1)[0];
}

export type LoginReturnMethod =
  | 'password'
  | 'google'
  | 'microsoft'
  | 'apple'
  | 'notion';

export function logLoginReturnUsed(path: string, via: LoginReturnMethod): void {
  console.info(`[login-return] used via=${via} section=${sectionOf(path)}`);
}
