import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Gives every request a correlation id: an inbound X-Request-Id is honored
 * when it is UUID-shaped (so a proxy or the native app can thread its own),
 * anything else gets a fresh UUID. Downstream code reads
 * res.locals.requestId; the response echoes X-Request-Id so a user-reported
 * failure can be joined to server logs.
 */
export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const inbound = req.headers['x-request-id'];
  const requestId =
    typeof inbound === 'string' && UUID_RE.test(inbound)
      ? inbound.toLowerCase()
      : crypto.randomUUID();
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
};
