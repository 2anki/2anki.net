import { vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { anonIdMiddleware } from './anonIdMiddleware';

function makeReqRes(opts: { existingCookie?: string; path?: string } = {}) {
  const cookies: Record<string, string> = {};
  if (opts.existingCookie) {
    cookies['anon_id'] = opts.existingCookie;
  }
  const req = { cookies, path: opts.path ?? '/' } as unknown as Request;
  const setCookieArgs: Array<[string, string, object]> = [];
  const res = {
    cookie: vi.fn((name: string, value: string, options: object) => {
      setCookieArgs.push([name, value, options]);
    }),
  } as unknown as Response;
  const next: NextFunction = vi.fn();
  return { req, res, next, setCookieArgs };
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('anonIdMiddleware', () => {
  it('sets anon_id cookie when absent', () => {
    const { req, res, next, setCookieArgs } = makeReqRes();
    anonIdMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(setCookieArgs).toHaveLength(1);
    const [name, value] = setCookieArgs[0];
    expect(name).toBe('anon_id');
    expect(UUID_PATTERN.test(value)).toBe(true);
  });

  it('cookie options include 1-year maxAge and SameSite=lax', () => {
    const { req, res, next, setCookieArgs } = makeReqRes();
    anonIdMiddleware(req, res, next);
    const opts = setCookieArgs[0][2] as Record<string, unknown>;
    expect(opts.sameSite).toBe('lax');
    expect(opts.maxAge).toBe(365 * 24 * 60 * 60 * 1000);
    expect(opts.httpOnly).toBe(false);
  });

  it('preserves existing anon_id without setting a new one', () => {
    const { req, res, next, setCookieArgs } = makeReqRes({
      existingCookie: 'existing-anon-id',
    });
    anonIdMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(setCookieArgs).toHaveLength(0);
  });

  it('generates a different UUID on each call when no cookie exists', () => {
    const {
      req: req1,
      res: res1,
      next: next1,
      setCookieArgs: c1,
    } = makeReqRes();
    const {
      req: req2,
      res: res2,
      next: next2,
      setCookieArgs: c2,
    } = makeReqRes();
    anonIdMiddleware(req1, res1, next1);
    anonIdMiddleware(req2, res2, next2);
    expect(c1[0][1]).not.toBe(c2[0][1]);
  });

  it.each([
    ['/assets/index-CcTRzipW.js'],
    ['/assets/HomePage-BvtfqaPi.css'],
    ['/templates/email-preview.html'],
  ])('skips Set-Cookie on static path %s', (path) => {
    const { req, res, next, setCookieArgs } = makeReqRes({ path });
    anonIdMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(setCookieArgs).toHaveLength(0);
  });

  it('still sets Set-Cookie on non-static paths like /api/events', () => {
    const { req, res, next, setCookieArgs } = makeReqRes({
      path: '/api/events',
    });
    anonIdMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(setCookieArgs).toHaveLength(1);
  });
});
