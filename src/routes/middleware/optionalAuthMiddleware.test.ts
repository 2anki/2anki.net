import { Request, Response } from 'express';
import { vi } from 'vitest';

import { makeOptionalAuthMiddleware } from './optionalAuthMiddleware';
import AuthenticationService from '../../services/AuthenticationService';

function run(token: string | undefined) {
  const authService = {
    getUserFrom: vi.fn(async (value: string) =>
      value === 'valid-session' ? { owner: 42 } : null
    ),
  } as unknown as AuthenticationService;
  const req = { cookies: token == null ? {} : { token } } as Request;
  const res = { locals: {} } as Response;
  const next = vi.fn();
  return makeOptionalAuthMiddleware(authService)(req, res, next).then(() => ({
    res,
    next,
  }));
}

describe('makeOptionalAuthMiddleware', () => {
  it('sets the owner for a valid session and carries on', async () => {
    const { res, next } = await run('valid-session');

    expect(res.locals.owner).toBe(42);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'expired-session'])(
    'carries on signed out when the session is %s',
    async (token) => {
      const { res, next } = await run(token);

      expect(res.locals.owner).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    }
  );
});
