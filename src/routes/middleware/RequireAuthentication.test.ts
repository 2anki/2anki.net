import { vi, type Mock } from 'vitest';
import express from 'express';

import RequireAuthentication, {
  RequireAuthenticationOrLogin,
} from './RequireAuthentication';
import { configureUserLocal } from './configureUserLocal';

vi.mock('../../data_layer', () => ({ getDatabase: vi.fn(() => ({})) }));
vi.mock('./configureUserLocal', () => ({ configureUserLocal: vi.fn() }));

const configureUserLocalMock = configureUserLocal as unknown as Mock;

interface FakeResponse {
  statusCode: number;
  body: unknown;
  locals: Record<string, unknown>;
  status: Mock;
  json: Mock;
  redirect: Mock;
}

const makeResponse = (): FakeResponse => {
  const state = {
    statusCode: 200,
    body: undefined,
    locals: {},
  } as FakeResponse;
  state.status = vi.fn((code: number) => {
    state.statusCode = code;
    return state;
  });
  state.json = vi.fn((body: unknown) => {
    state.body = body;
    return state;
  });
  state.redirect = vi.fn();
  return state;
};

const makeRequest = (
  overrides: Partial<express.Request> = {}
): express.Request =>
  ({
    method: 'GET',
    headers: {},
    cookies: {},
    originalUrl: '/api/download/u/abc',
    ...overrides,
  }) as unknown as express.Request;

const signIn = (owner: number) =>
  configureUserLocalMock.mockImplementation(
    async (_req, res: express.Response) => {
      res.locals.owner = owner;
    }
  );

beforeEach(() => {
  vi.resetAllMocks();
});

describe('RequireAuthenticationOrLogin', () => {
  it('calls next when the request is authenticated', async () => {
    signIn(42);
    const res = makeResponse();
    const next = vi.fn();

    await RequireAuthenticationOrLogin(
      makeRequest(),
      res as unknown as express.Response,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('redirects an unauthenticated browser navigation to login with the download target', async () => {
    const res = makeResponse();
    const next = vi.fn();

    await RequireAuthenticationOrLogin(
      makeRequest({ headers: { accept: 'text/html' } } as never),
      res as unknown as express.Response,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      '/login?redirect=%2Fapi%2Fdownload%2Fu%2Fabc'
    );
  });

  it('returns 401 JSON to an unauthenticated API client', async () => {
    const res = makeResponse();
    const next = vi.fn();

    await RequireAuthenticationOrLogin(
      makeRequest({ headers: { accept: 'application/json' } } as never),
      res as unknown as express.Response,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ message: 'Authentication required' });
  });

  it('falls back to a bare /login for an off-site redirect target (no open redirect)', async () => {
    const res = makeResponse();
    const next = vi.fn();

    await RequireAuthenticationOrLogin(
      makeRequest({
        headers: { accept: 'text/html' },
        originalUrl: '//evil.example/api/download/u/abc',
      } as never),
      res as unknown as express.Response,
      next
    );

    expect(res.redirect).toHaveBeenCalledWith(302, '/login');
  });
});

describe('RequireAuthentication', () => {
  it('returns 401 JSON even for a browser navigation (rail-path contract unchanged)', async () => {
    const res = makeResponse();
    const next = vi.fn();

    await RequireAuthentication(
      makeRequest({ headers: { accept: 'text/html' } } as never),
      res as unknown as express.Response,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ message: 'Authentication required' });
  });
});
