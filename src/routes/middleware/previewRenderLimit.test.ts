import { vi, type Mock } from 'vitest';
import { Request, Response, NextFunction } from 'express';

import { concurrencyLimit, ownerRateLimit } from './previewRenderLimit';
import { InMemoryRateLimiter } from '../../lib/rateLimit/InMemoryRateLimiter';
import { ConcurrencyLimiter } from '../../lib/rateLimit/ConcurrencyLimiter';

function makeRes(locals: Record<string, unknown>): Response {
  const handlers: Record<string, Array<() => void>> = {};
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    locals,
    on: vi.fn((event: string, handler: () => void) => {
      (handlers[event] ??= []).push(handler);
      return res;
    }),
    emit: (event: string) => (handlers[event] ?? []).forEach((h) => h()),
  } as unknown as Response & { emit: (event: string) => void };
  return res;
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

describe('concurrencyLimit', () => {
  it('acquires a slot and releases it when the response finishes', () => {
    const limiter = new ConcurrencyLimiter(1);
    const next = vi.fn() as NextFunction;
    const res = makeRes({}) as Response & { emit: (event: string) => void };

    concurrencyLimit(limiter)({} as Request, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(limiter.inFlight).toBe(1);

    res.emit('finish');
    expect(limiter.inFlight).toBe(0);
  });

  it('answers 503 when the render pool is full', () => {
    const limiter = new ConcurrencyLimiter(1);
    const next = vi.fn() as NextFunction;

    concurrencyLimit(limiter)({} as Request, makeRes({}), next);
    const blocked = makeRes({});
    concurrencyLimit(limiter)({} as Request, blocked, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(blocked.status).toHaveBeenCalledWith(503);
  });

  it('frees the slot once even if finish and close both fire', () => {
    const limiter = new ConcurrencyLimiter(1);
    const next = vi.fn() as NextFunction;
    const res = makeRes({}) as Response & { emit: (event: string) => void };

    concurrencyLimit(limiter)({} as Request, res, next);
    res.emit('finish');
    res.emit('close');

    expect(limiter.inFlight).toBe(0);
  });
});
