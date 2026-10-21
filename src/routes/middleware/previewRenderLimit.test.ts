import { vi, type Mock } from 'vitest';
import { Request, Response, NextFunction } from 'express';

import { ownerRateLimit } from './previewRenderLimit';
import { InMemoryRateLimiter } from '../../lib/rateLimit/InMemoryRateLimiter';

function makeRes(locals: Record<string, unknown>): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    locals,
  } as unknown as Response;
}

describe('ownerRateLimit', () => {
  it('passes a signed-in owner through under the per-key cap', () => {
    const limiter = new InMemoryRateLimiter({
      windowMs: 60_000,
      perKeyMax: 2,
      globalMax: 100,
    });
    const next = vi.fn() as NextFunction;
    const res = makeRes({ owner: 7 });

    ownerRateLimit(limiter)({} as Request, res, next);
    ownerRateLimit(limiter)({} as Request, res, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers 429 once the owner exceeds the per-key cap', () => {
    const limiter = new InMemoryRateLimiter({
      windowMs: 60_000,
      perKeyMax: 1,
      globalMax: 100,
    });
    const next = vi.fn() as NextFunction;
    const res = makeRes({ owner: 7 });

    ownerRateLimit(limiter)({} as Request, res, next);
    ownerRateLimit(limiter)({} as Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('keys per owner, so one owner at the cap does not block another', () => {
    const limiter = new InMemoryRateLimiter({
      windowMs: 60_000,
      perKeyMax: 1,
      globalMax: 100,
    });
    const next = vi.fn() as NextFunction;

    ownerRateLimit(limiter)({} as Request, makeRes({ owner: 7 }), next);
    ownerRateLimit(limiter)({} as Request, makeRes({ owner: 7 }), next);
    ownerRateLimit(limiter)({} as Request, makeRes({ owner: 99 }), next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('skips the limit for a missing owner', () => {
    const limiter = { check: vi.fn() } as unknown as InMemoryRateLimiter;
    const next = vi.fn() as NextFunction;

    ownerRateLimit(limiter)({} as Request, makeRes({ owner: undefined }), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((limiter.check as Mock).mock.calls).toHaveLength(0);
  });
});
