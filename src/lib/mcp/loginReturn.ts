import type { CookieOptions, Request, Response } from 'express';
import { sanitizeRelativeRedirect } from '../../controllers/helpers/sanitizeRelativeRedirect';

export const MCP_AUTHORIZE_PATH = '/mcp/authorize';
export const MCP_LOGIN_RETURN_COOKIE = 'mcp_login_return';
export const MCP_LOGIN_RETURN_MAX_AGE_MS = 10 * 60 * 1000;

// Browsers drop a cookie over ~4KB without telling anyone; a value this long
// is not an authorize URL a real connector sends, so it is not remembered.
const MAX_REMEMBERED_LENGTH = 2048;

// SameSite=None (with Secure) because Sign in with Apple returns by a
// cross-site form POST, which never carries a Lax cookie. The value is only
// ever a same-origin path to the authorize endpoint, which still shows the
// consent screen, so sending it cross-site leaks nothing and grants nothing.
const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  path: '/',
});

// The MCP authorize endpoint, with its query intact, as a same-origin
// relative path. Anything else, including look-alike paths, protocol-relative
// and absolute URLs, and backslash tricks, is rejected.
export function asMcpAuthorizeReturn(value: unknown): string | undefined {
  const safe = sanitizeRelativeRedirect(value);
  if (safe == null) {
    return undefined;
  }
  if (
    safe === MCP_AUTHORIZE_PATH ||
    safe.startsWith(`${MCP_AUTHORIZE_PATH}?`)
  ) {
    return safe;
  }
  return undefined;
}

// Remembers where a signed-out connector authorize request came from, so
// whichever sign-in method the user picks can send them back to consent.
export function rememberMcpLoginReturn(res: Response, value: unknown): void {
  const safe = asMcpAuthorizeReturn(value);
  if (safe == null || safe.length > MAX_REMEMBERED_LENGTH) {
    return;
  }
  res.cookie(MCP_LOGIN_RETURN_COOKIE, safe, {
    ...cookieOptions(),
    maxAge: MCP_LOGIN_RETURN_MAX_AGE_MS,
  });
}

// Reads and clears the remembered authorize return. It is cleared whenever
// present, valid or not, so it can steer at most one sign-in.
export function takeMcpLoginReturn(
  req: Request,
  res: Response
): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const raw = cookies?.[MCP_LOGIN_RETURN_COOKIE];
  if (raw == null) {
    return undefined;
  }
  res.clearCookie(MCP_LOGIN_RETURN_COOKIE, cookieOptions());
  return asMcpAuthorizeReturn(raw);
}
