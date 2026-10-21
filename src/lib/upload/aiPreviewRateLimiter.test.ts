import { describe, it, expect } from 'vitest';
import {
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
});
