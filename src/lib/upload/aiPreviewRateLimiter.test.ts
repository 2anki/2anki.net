import { describe, it, expect } from 'vitest';
import {
  AI_PREVIEW_GLOBAL_MAX,
  AI_PREVIEW_PER_IP_MAX,
  AI_PREVIEW_PER_VISITOR_MAX,
  AiPreviewRateLimiter,
} from './aiPreviewRateLimiter';

function fixedClock() {
  return () => 1_000;
}

describe('AiPreviewRateLimiter', () => {
  it('allows a visitor up to the per-visitor daily cap, then blocks them', () => {
    const limiter = new AiPreviewRateLimiter(fixedClock());
    for (let i = 0; i < AI_PREVIEW_PER_VISITOR_MAX; i++) {
      expect(limiter.allow('visitor-a', 'ip-1')).toBe(true);
    }
    expect(limiter.allow('visitor-a', 'ip-1')).toBe(false);
  });

  it('blocks a shared IP once the per-IP cap is reached, across distinct visitors', () => {
    const limiter = new AiPreviewRateLimiter(fixedClock());
    for (let i = 0; i < AI_PREVIEW_PER_IP_MAX; i++) {
      expect(limiter.allow(`visitor-${i}`, 'shared-ip')).toBe(true);
    }
    expect(limiter.allow('visitor-new', 'shared-ip')).toBe(false);
  });

  it('lets a different visitor on a different IP through', () => {
    const limiter = new AiPreviewRateLimiter(fixedClock());
    for (let i = 0; i < AI_PREVIEW_PER_VISITOR_MAX; i++) {
      limiter.allow('visitor-a', 'ip-1');
    }
    expect(limiter.allow('visitor-a', 'ip-1')).toBe(false);
    expect(limiter.allow('visitor-b', 'ip-2')).toBe(true);
  });

  it('a rotated anon_id from one IP cannot outrun the per-IP cap', () => {
    const limiter = new AiPreviewRateLimiter(fixedClock());
    // A script mints a fresh anon_id every request — the per-visitor cap never
    // trips, but the per-IP cap is the binding ceiling and still holds.
    let allowed = 0;
    for (let i = 0; i < AI_PREVIEW_PER_IP_MAX + 10; i++) {
      if (limiter.allow(`fresh-${i}`, 'one-ip')) allowed += 1;
    }
    expect(allowed).toBe(AI_PREVIEW_PER_IP_MAX);
  });

  it('blocks once the global daily budget is spent, across many IPs', () => {
    const limiter = new AiPreviewRateLimiter(fixedClock());
    let allowed = 0;
    for (let i = 0; i < AI_PREVIEW_GLOBAL_MAX + 5; i++) {
      // distinct visitor and IP each call, so only the global cap can bind
      if (limiter.allow(`v-${i}`, `ip-${i}`)) allowed += 1;
    }
    expect(allowed).toBe(AI_PREVIEW_GLOBAL_MAX);
  });
});
