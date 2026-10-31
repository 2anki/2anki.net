import { Request, Response } from 'express';
import { vi } from 'vitest';

import {
  makeDownloadIdentityMiddleware,
  makeOptionalAuthMiddleware,
} from './optionalAuthMiddleware';
import AuthenticationService from '../../services/AuthenticationService';

function fakeAuthService(): AuthenticationService {
  return {
    getUserFrom: vi.fn(async (value: string) => {
      if (value === 'database-down') {
        throw new TypeError('connection lost');
      }
      return value === 'valid-session'
        ? { owner: 42, email: 'buyer@example.com' }
        : null;
    }),
  } as unknown as AuthenticationService;
}

function request(token: string | undefined): Request {
  return { cookies: token == null ? {} : { token } } as Request;
}

describe('makeOptionalAuthMiddleware', () => {
  it('sets the owner for a valid session and carries on', async () => {
    const res = { locals: {} } as Response;
    const next = vi.fn();

    await makeOptionalAuthMiddleware(fakeAuthService())(
      request('valid-session'),
      res,
      next
    );

    expect(res.locals.owner).toBe(42);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets the account email for a valid session so checkout can prefill it', async () => {
    const res = { locals: {} } as Response;

    await makeOptionalAuthMiddleware(fakeAuthService())(
      request('valid-session'),
      res,
      vi.fn()
    );

    expect(res.locals.email).toBe('buyer@example.com');
  });

  it.each([undefined, 'expired-session'])(
    'leaves owner and email unset when the session is %s',
    async (token) => {
      const res = { locals: {} } as Response;
      const next = vi.fn();

      await makeOptionalAuthMiddleware(fakeAuthService())(
        request(token),
        res,
        next
      );

      expect(res.locals).toEqual({});
      expect(next).toHaveBeenCalledTimes(1);
    }
  );

  it('still rejects when the session lookup fails, so owner-gated routes never read it as signed out', async () => {
    const next = vi.fn();

    await expect(
      makeOptionalAuthMiddleware(fakeAuthService())(
        request('database-down'),
        { locals: {} } as Response,
        next
      )
    ).rejects.toThrow(TypeError);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('makeDownloadIdentityMiddleware', () => {
  it('sets the owner for a valid session and carries on', async () => {
    const res = { locals: {} } as Response;
    const next = vi.fn();

    await makeDownloadIdentityMiddleware(fakeAuthService())(
      request('valid-session'),
      res,
      next
    );

    expect(res.locals.owner).toBe(42);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'expired-session'])(
    'carries on signed out when the session is %s',
    async (token) => {
      const res = { locals: {} } as Response;
      const next = vi.fn();

      await makeDownloadIdentityMiddleware(fakeAuthService())(
        request(token),
        res,
        next
      );

      expect(res.locals.owner).toBeUndefined();
      expect(next).toHaveBeenCalledTimes(1);
    }
  );

  it('serves the download signed out when the session lookup fails, logging only the error class', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = { locals: {} } as Response;
    const next = vi.fn();

    await makeDownloadIdentityMiddleware(fakeAuthService())(
      request('database-down'),
      res,
      next
    );

    expect(res.locals.owner).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[download-identity] session lookup failed',
      { errorClass: 'TypeError' }
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('database-down');
    warn.mockRestore();
  });
});
