import type { NextFunction, Request, Response } from 'express';
import { resolveClientIp } from '../../lib/rateLimit/ipHelpers';

interface Counter {
  count: number;
  resetAt: number;
}

const ONE_MINUTE_MS = 60 * 1000;

/**
 * Fixed-window per-IP limiter for unauthenticated routes that cost an
 * upstream call each (Stripe reads, share lookups). One counter map per
 * middleware instance, so routes do not share budgets.
 */
export function ipRateLimit(limitPerMinute: number, maxTrackedIps = 5000) {
  const counters = new Map<string, Counter>();
  const sweepExpired = (now: number) => {
    for (const [key, value] of counters) {
      if (now >= value.resetAt) {
        counters.delete(key);
      }
    }
  };
  return function limit(req: Request, res: Response, next: NextFunction) {
    const ip = resolveClientIp(req);
    const now = Date.now();
    // The map is keyed by caller ip, so a scan from many addresses would grow
    // it without bound; drop expired windows once it gets large.
    if (counters.size >= maxTrackedIps) {
      sweepExpired(now);
      if (counters.size >= maxTrackedIps) {
        const oldest = counters.keys().next().value;
        if (oldest != null) {
          counters.delete(oldest);
        }
      }
    }
    const entry = counters.get(ip);
    if (entry == null || now >= entry.resetAt) {
      counters.set(ip, { count: 1, resetAt: now + ONE_MINUTE_MS });
      next();
      return;
    }
    if (entry.count >= limitPerMinute) {
      res
        .status(429)
        .json({ message: 'Too many requests. Try again in a minute.' });
      return;
    }
    entry.count++;
    next();
  };
}
