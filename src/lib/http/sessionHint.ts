import type express from 'express';

/**
 * Whether the request carries a session cookie at all — not whether the
 * session is valid. The shell uses it only to pick a first-paint layout
 * before the client learns who is signed in; never authorize on it.
 */
export function hasSessionCookie(req: express.Request): boolean {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const token = cookies?.token;
  return typeof token === 'string' && token.length > 0;
}
