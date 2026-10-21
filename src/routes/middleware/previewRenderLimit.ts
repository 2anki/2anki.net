import type { NextFunction, Request, Response } from 'express';
import type { RateLimiter } from '../../lib/rateLimit/InMemoryRateLimiter';
import type { ConcurrencyLimiter } from '../../lib/rateLimit/ConcurrencyLimiter';

// Per-owner window on top of the per-IP ipRateLimit: a single signed-in user
// sharing one IP (or rotating IPs) cannot drive the render pool on their own.
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

// Bounds concurrent preview renders on the process. Acquires before the upload
// and render, releases when the response ends (finish or an aborted close), so
// a slow upload or render frees its slot exactly once.
export function concurrencyLimit(limiter: ConcurrencyLimiter) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!limiter.tryAcquire()) {
      res.status(503).json({
        message:
          'Too many previews are rendering right now. Try again in a moment.',
      });
      return;
    }
    let released = false;
    const release = () => {
      if (released) {
        return;
      }
      released = true;
      limiter.release();
    };
    res.on('finish', release);
    res.on('close', release);
    next();
  };
}
