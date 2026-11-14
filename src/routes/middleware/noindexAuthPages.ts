import { Request, Response, NextFunction } from 'express';

// These five pages carry a robots meta from the client (NoIndex), but that
// only exists after the app renders. The served HTML is the shared shell with
// the homepage title, so crawlers that index before rendering filed
// /register?source=… and /login?redirect=… as copies of the homepage.
const AUTH_PAGES = new Set([
  '/login',
  '/register',
  '/forgot',
  '/auth/magic',
  '/account/email-change',
]);

// /users/r/<token> is the page a password reset email opens. It carries no
// robots meta of its own, and its address holds a one-time token.
const RESET_PASSWORD_PREFIX = '/users/r/';

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

export function noindexAuthPages(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const path = req.path.toLowerCase();
  const isAuthPage =
    AUTH_PAGES.has(withoutTrailingSlash(path)) ||
    path.startsWith(RESET_PASSWORD_PREFIX);
  if (isAuthPage && res.getHeader('X-Robots-Tag') == null) {
    res.setHeader('X-Robots-Tag', 'noindex');
  }
  next();
}
