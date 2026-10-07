import { vi } from 'vitest';
import express from 'express';

import { makeRequireOpsAccess } from './RequireOpsAccess';
import AuthenticationService from '../../services/AuthenticationService';

const buildRes = () => {
  const status = vi.fn().mockReturnThis();
  const end = vi.fn();
  const locals: Record<string, unknown> = {};
  return {
    status,
    end,
    locals,
  } as unknown as express.Response;
};

const buildReq = (token: string | undefined) =>
  ({
    cookies: token == null ? {} : { token },
  }) as unknown as express.Request;

describe('RequireOpsAccess', () => {
  it('responds 404 (does not reveal existence) when no token is sent', async () => {
    const auth = {
      getUserFrom: vi.fn().mockResolvedValue(null),
    } as unknown as AuthenticationService;
    const middleware = makeRequireOpsAccess(auth);
    const req = buildReq(undefined);
    const res = buildRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('responds 404 when the user email is not the ops owner', async () => {
    const auth = {
      getUserFrom: vi
        .fn()
        .mockResolvedValue({ owner: 7, email: 'someone@else.com', id: 7 }),
    } as unknown as AuthenticationService;
    const middleware = makeRequireOpsAccess(auth);
    const req = buildReq('jwt');
    const res = buildRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes through and exposes email/owner for the ops owner (case-insensitive)', async () => {
    const auth = {
      getUserFrom: vi.fn().mockResolvedValue({
        owner: 1,
        email: 'Alexander@Alemayhu.com',
        id: 1,
      }),
    } as unknown as AuthenticationService;
    const middleware = makeRequireOpsAccess(auth);
    const req = buildReq('jwt');
    const res = buildRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.locals.email).toBe('Alexander@Alemayhu.com');
    expect(res.locals.owner).toBe(1);
  });
});
