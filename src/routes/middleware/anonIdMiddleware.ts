import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

const ANON_ID_COOKIE = 'anon_id';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const SKIP_PREFIXES = ['/assets/', '/templates/'];

export function anonIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const path = req.path ?? '';
  if (SKIP_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    next();
    return;
  }
  const existing = req.cookies?.[ANON_ID_COOKIE];
  if (existing) {
    next();
    return;
  }
  const id = randomUUID();
  res.cookie(ANON_ID_COOKIE, id, {
    maxAge: ONE_YEAR_MS,
    sameSite: 'lax',
    httpOnly: false,
  });
  res.locals.mintedAnonId = id;
  next();
}
