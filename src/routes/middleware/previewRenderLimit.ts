import type { NextFunction, Request, Response } from 'express';
import type { RateLimiter } from '../../lib/rateLimit/InMemoryRateLimiter';

// Per-owner window on top of the per-IP ipRateLimit: a single signed-in user
// sharing one IP (or rotating IPs) cannot drive the render pool on their own.
// The process-wide cap on concurrent Chrome renders lives in the controller,
// held for the render's lifetime so a client abort cannot free it early.
export function ownerRateLimit(limiter: RateLimiter) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const owner = res.locals.owner;
    if (owner == null) {
      next();
      return;
    }
    if (!limiter.check(`owner:${owner}`)) {
      res.status(429).json({
        message: 'Too many preview requests. Try again in a minute.',
      });
      return;
    }
    next();
  };
}
