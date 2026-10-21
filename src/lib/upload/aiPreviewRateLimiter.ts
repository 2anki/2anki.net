import { InMemoryRateLimiter } from '../rateLimit/InMemoryRateLimiter';

const DAY_MS = 24 * 60 * 60 * 1000;

// The free preview is capped three ways so a script cannot turn it into open AI
// spend: a per-visitor daily cap, a per-IP daily cap (the #4802 backstop, since
// the anon_id cookie is client-minted), and a global daily budget that bounds
// total preview spend regardless of how the keys rotate.
export const AI_PREVIEW_PER_VISITOR_MAX = 3;
export const AI_PREVIEW_PER_IP_MAX = 20;
export const AI_PREVIEW_GLOBAL_MAX = 2000;

export class AiPreviewRateLimiter {
  private readonly visitorLimiter: InMemoryRateLimiter;
  private readonly ipLimiter: InMemoryRateLimiter;

  constructor(now?: () => number) {
    this.visitorLimiter = new InMemoryRateLimiter({
      windowMs: DAY_MS,
      perKeyMax: AI_PREVIEW_PER_VISITOR_MAX,
      globalMax: AI_PREVIEW_GLOBAL_MAX,
      now,
    });
    this.ipLimiter = new InMemoryRateLimiter({
      windowMs: DAY_MS,
      perKeyMax: AI_PREVIEW_PER_IP_MAX,
      globalMax: AI_PREVIEW_GLOBAL_MAX,
      now,
    });
  }

  // True only when the visitor, their IP, and the global budget all have room.
  allow(anonId: string, ipKey: string): boolean {
    if (this.visitorLimiter.evaluate(anonId) !== 'allowed') {
      return false;
    }
    if (this.ipLimiter.evaluate(ipKey) !== 'allowed') {
      return false;
    }
    return true;
  }
}
