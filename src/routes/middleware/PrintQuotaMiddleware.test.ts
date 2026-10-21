import { vi, type Mock } from 'vitest';
import { Request, Response, NextFunction } from 'express';

import { printQuotaMiddleware } from './PrintQuotaMiddleware';
import { MonthlyPrintLimitError } from '../../usecases/users/CheckMonthlyPrintLimitUseCase';
import UsersRepository from '../../data_layer/UsersRepository';

function makeRepo(overrides: Partial<UsersRepository> = {}): UsersRepository {
  return {
    getPrintUsage: vi.fn().mockResolvedValue({ prints_used: 0 }),
    incrementPrintUsage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as UsersRepository;
}

function makeRes(locals: Record<string, unknown>): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    locals,
    statusCode: 200,
    on: vi.fn(),
  } as unknown as Response;
}

describe('printQuotaMiddleware — the free-print gate the preview route omits', () => {
  it('lets a paying user through without reading or incrementing usage', async () => {
    const repo = makeRepo();
    const next = vi.fn() as NextFunction;
    const res = makeRes({ owner: 7, subscriber: true });

    await printQuotaMiddleware(repo)({} as Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(repo.getPrintUsage).not.toHaveBeenCalled();
    expect(repo.incrementPrintUsage).not.toHaveBeenCalled();
  });

  it('returns 401 for an anonymous caller', async () => {
    const repo = makeRepo();
    const next = vi.fn() as NextFunction;
    const res = makeRes({ owner: undefined });

    await printQuotaMiddleware(repo)({} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 402 once a free user has used their monthly print', async () => {
    const repo = makeRepo({
      getPrintUsage: vi.fn().mockResolvedValue({ prints_used: 1 }),
    });
    const next = vi.fn() as NextFunction;
    const res = makeRes({ owner: 7 });

    await printQuotaMiddleware(repo)({} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(next).not.toHaveBeenCalled();
  });

  it('increments usage only on a 200 finish for a free user with the print available', async () => {
    const repo = makeRepo();
    const next = vi.fn() as NextFunction;
    const finishHandlers: Array<() => void> = [];
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      locals: { owner: 7 },
      statusCode: 200,
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') finishHandlers.push(handler);
      }),
    } as unknown as Response;

    await printQuotaMiddleware(repo)({} as Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(repo.incrementPrintUsage).not.toHaveBeenCalled();

    finishHandlers.forEach((handler) => handler());
    expect(repo.incrementPrintUsage).toHaveBeenCalledWith(7);
  });

  it('does not increment usage when the response finishes non-200', async () => {
    const repo = makeRepo();
    const next = vi.fn() as NextFunction;
    const finishHandlers: Array<() => void> = [];
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      locals: { owner: 7 },
      statusCode: 400,
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') finishHandlers.push(handler);
      }),
    } as unknown as Response;

    await printQuotaMiddleware(repo)({} as Request, res, next);
    finishHandlers.forEach((handler) => handler());

    expect(repo.incrementPrintUsage).not.toHaveBeenCalled();
  });

  it('propagates a non-limit error instead of swallowing it', async () => {
    const repo = makeRepo({
      getPrintUsage: vi.fn().mockRejectedValue(new Error('db down')),
    });
    const next = vi.fn() as NextFunction;
    const res = makeRes({ owner: 7 });

    await expect(
      printQuotaMiddleware(repo)({} as Request, res, next)
    ).rejects.toThrow('db down');
  });

  it('exposes MonthlyPrintLimitError with a reset date for the 402 body', () => {
    const error = new MonthlyPrintLimitError(1, 1, '2026-11-01T00:00:00.000Z');
    expect(error.reset_on).toBe('2026-11-01T00:00:00.000Z');
    expect(error.name).toBe('MonthlyPrintLimitError');
  });
});
