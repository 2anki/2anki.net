import { InMemoryRateLimiter } from '../rateLimit/InMemoryRateLimiter';

const DAY_MS = 24 * 60 * 60 * 1000;

// The free preview is capped three ways so a script cannot turn it into open AI
// spend. The anon_id cookie is client-minted and freely rotatable, so the
// per-visitor cap is only a courtesy limit — it cannot be the binding one. The
// BINDING caps are the per-IP cap (keyed on the trusted proxy-resolved address,
// /64-bucketed by the caller, the #4802 backstop) and the global daily budget,
// both of which hold no matter how the visitor key rotates. The IP cap is
// checked independently of the visitor cap for exactly this reason.
//
// This limiter is per-process and in memory, mirroring the held-deck caps
// (#4802): across N app processes the real ceiling is N× these numbers. That is
// the accepted bound — the global daily cap keeps the worst case (a single
// preview's cost is hard-bounded by aiPreview.ts) bounded per process, and a
// preview that slips past is a capped, un-metered sample, never a full paid
// conversion.
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

  // True only when the IP, the visitor, and the global budget all have room.
  // The IP cap is evaluated first and independently so a rotated anon_id cannot
  // skip it — the per-IP ceiling is what actually holds spend down.
  allow(anonId: string, ipKey: string): boolean {
    if (this.ipLimiter.evaluate(ipKey) !== 'allowed') {
      return false;
    }
    if (this.visitorLimiter.evaluate(anonId) !== 'allowed') {
      return false;
    }
    return true;
  }
}
