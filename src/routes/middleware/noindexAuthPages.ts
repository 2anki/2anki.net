import { Request, Response, NextFunction } from 'express';

// The same five pages carry a robots meta from the client (NoIndex), but that
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

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

export function noindexAuthPages(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const isAuthPage = AUTH_PAGES.has(
    withoutTrailingSlash(req.path.toLowerCase())
  );
  if (isAuthPage && res.getHeader('X-Robots-Tag') == null) {
    res.setHeader('X-Robots-Tag', 'noindex');
  }
  next();
}
