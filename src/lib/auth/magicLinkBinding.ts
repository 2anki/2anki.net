import crypto from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';

import hmacToken from '../misc/hmacToken';

const MAGIC_LINK_BINDING_MAX_AGE_MS = 15 * 60 * 1000;
const BINDING_PATTERN = /^[0-9a-f]{64}$/;

const isProduction = () => process.env.NODE_ENV === 'production';

// In production the __Host- prefix makes browsers refuse this cookie from any
// sibling subdomain, so nobody else on 2anki.net can plant a binding for a
// token they own. The prefix needs Secure, so plain-http development keeps the
// bare name. Path=/ is part of the prefix contract; the value is an HttpOnly
// HMAC that lives 15 minutes, so sending it with every request costs nothing.
export function magicLinkBindingCookieName(): string {
  return isProduction() ? '__Host-magic_link_binding' : 'magic_link_binding';
}

// The binding is a keyed hash of the emailed token, so it proves only that
// this browser received the response to the request that issued the link. It
// cannot be turned back into the token and is useless without it: whoever
// holds the token can already sign in through the confirm step, and the
// binding only lets the requesting browser skip that click.
const bindingCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction(),
  path: '/',
});

export function magicLinkBindingFor(token: string): string {
  return hmacToken(`magic-link-binding:${token}`);
}

function readBinding(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[magicLinkBindingCookieName()];
  return typeof value === 'string' && BINDING_PATTERN.test(value)
    ? value
    : undefined;
}

function header(req: Request, name: string): string | undefined {
  const value = req.headers?.[name];
  return typeof value === 'string' ? value : undefined;
}

function isCrossOrigin(req: Request): boolean {
  const site = header(req, 'sec-fetch-site');
  return site != null && site !== 'same-origin';
}

// Every accepted request gets a fresh cookie of the same shape, whether or not
// a link was issued, so neither the header nor its value says whether the
// address has an account.
export function rememberMagicLinkBinding(
  req: Request,
  res: Response,
  issuedToken: string | undefined
): void {
  if (isCrossOrigin(req)) {
    return;
  }
  const value =
    issuedToken == null
      ? crypto.randomBytes(32).toString('hex')
      : magicLinkBindingFor(issuedToken);
  res.cookie(magicLinkBindingCookieName(), value, {
    ...bindingCookieOptions(),
    maxAge: MAGIC_LINK_BINDING_MAX_AGE_MS,
  });
}

export function clearMagicLinkBinding(res: Response): void {
  res.clearCookie(magicLinkBindingCookieName(), bindingCookieOptions());
}

export function isBoundToThisBrowser(req: Request, token: string): boolean {
  const received = readBinding(req);
  if (received == null) {
    return false;
  }
  const expected = Buffer.from(magicLinkBindingFor(token));
  const actual = Buffer.from(received);
  return (
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  );
}

const PREFETCH_HEADERS = ['purpose', 'sec-purpose', 'x-moz'];

export function isPrefetchRequest(req: Request): boolean {
  if (req.method === 'HEAD') {
    return true;
  }
  return PREFETCH_HEADERS.some((name) =>
    (header(req, name) ?? '').toLowerCase().startsWith('prefetch')
  );
}

// A cross-site page cannot send a JSON body here: a form cannot set that
// content type, and a script needs a CORS preflight this API never grants.
// Fetch metadata, where the browser sends it, must also say same-origin.
export function isSameOriginJsonRequest(req: Request): boolean {
  return typeof req.is('application/json') === 'string' && !isCrossOrigin(req);
}
