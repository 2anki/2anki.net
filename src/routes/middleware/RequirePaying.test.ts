import { vi, type MockedFunction } from 'vitest';
import express, { NextFunction } from 'express';

import { configureUserLocal } from './configureUserLocal';
import RequirePaying from './RequirePaying';

vi.mock('./configureUserLocal');
vi.mock('../../data_layer', () => ({
  getDatabase: vi.fn(function () {
    return {};
  }),
}));
vi.mock('../../data_layer/TokenRepository', () => ({
  __esModule: true,
  default: vi.fn(),
}));
vi.mock('../../data_layer/UsersRepository', () => ({
  __esModule: true,
  default: vi.fn(),
}));
vi.mock('../../services/AuthenticationService', () => ({
  __esModule: true,
  default: vi.fn(),
}));

const configureUserLocalMock = configureUserLocal as MockedFunction<
  typeof configureUserLocal
>;

function makeResponse(locals: Record<string, unknown>) {
  const res = {
    locals,
    redirectedTo: undefined as string | undefined,
    redirect(location: string) {
      this.redirectedTo = location;
      return this;
    },
  };
  return res as unknown as express.Response & {
    redirectedTo: string | undefined;
  };
}

describe('RequirePaying', () => {
  beforeEach(() => {
    configureUserLocalMock.mockReset();
  });

  it('lets a paying subscriber through once locals resolve asynchronously', async () => {
    configureUserLocalMock.mockImplementation(async (_req, res) => {
      await Promise.resolve();
      res.locals.subscriber = true;
    });
    const res = makeResponse({});
    const next = vi.fn() as unknown as NextFunction;

    await RequirePaying({ cookies: {} } as express.Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirectedTo).toBeUndefined();
  });

  it('lets a lifetime patreon through once locals resolve asynchronously', async () => {
    configureUserLocalMock.mockImplementation(async (_req, res) => {
      await Promise.resolve();
      res.locals.patreon = true;
    });
    const res = makeResponse({});
    const next = vi.fn() as unknown as NextFunction;

    await RequirePaying({ cookies: {} } as express.Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirectedTo).toBeUndefined();
  });

  it('redirects a genuinely non-paying user to /pricing', async () => {
    configureUserLocalMock.mockImplementation(async (_req, res) => {
      await Promise.resolve();
      res.locals.subscriber = false;
      res.locals.patreon = false;
    });
    const res = makeResponse({});
    const next = vi.fn() as unknown as NextFunction;

    await RequirePaying({ cookies: {} } as express.Request, res, next);

    expect(res.redirectedTo).toBe('/pricing');
    expect(next).not.toHaveBeenCalled();
  });
});
