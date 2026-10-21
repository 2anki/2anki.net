import type { NextFunction, Request, Response } from 'express';

import { requireGoogleAdsCsvAuth } from './RequireGoogleAdsCsvAuth';

function makeResponse() {
  const res = {
    set: vi.fn(() => res),
    status: vi.fn(() => res),
    end: vi.fn(() => res),
  };
  return res as unknown as Response & {
    set: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  };
}

function requestWith(authorization?: string): Request {
  return { headers: authorization == null ? {} : { authorization } } as Request;
}

function basic(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

const ORIGINAL_USER = process.env.GOOGLE_ADS_OFFLINE_CSV_USER;
const ORIGINAL_PASSWORD = process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD;

describe('requireGoogleAdsCsvAuth', () => {
  afterEach(() => {
    process.env.GOOGLE_ADS_OFFLINE_CSV_USER = ORIGINAL_USER;
    process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD = ORIGINAL_PASSWORD;
  });

  it('returns 404 and never calls next when no credentials are configured', () => {
    delete process.env.GOOGLE_ADS_OFFLINE_CSV_USER;
    delete process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD;
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    requireGoogleAdsCsvAuth(requestWith(basic('u', 'p')), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when only one of the two variables is set', () => {
    process.env.GOOGLE_ADS_OFFLINE_CSV_USER = 'u';
    delete process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD;
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    requireGoogleAdsCsvAuth(requestWith(basic('u', 'p')), res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('challenges with 401 when no Authorization header is sent', () => {
    process.env.GOOGLE_ADS_OFFLINE_CSV_USER = 'u';
    process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD = 'p';
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    requireGoogleAdsCsvAuth(requestWith(), res, next);

    expect(res.set).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('Basic realm=')
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a wrong password with 401', () => {
    process.env.GOOGLE_ADS_OFFLINE_CSV_USER = 'u';
    process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD = 'correct';
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    requireGoogleAdsCsvAuth(requestWith(basic('u', 'wrong')), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a wrong username with 401', () => {
    process.env.GOOGLE_ADS_OFFLINE_CSV_USER = 'u';
    process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD = 'p';
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    requireGoogleAdsCsvAuth(requestWith(basic('intruder', 'p')), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when the credentials match', () => {
    process.env.GOOGLE_ADS_OFFLINE_CSV_USER = 'u';
    process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD = 'p';
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    requireGoogleAdsCsvAuth(requestWith(basic('u', 'p')), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('matches a password that contains a colon', () => {
    process.env.GOOGLE_ADS_OFFLINE_CSV_USER = 'u';
    process.env.GOOGLE_ADS_OFFLINE_CSV_PASSWORD = 'a:b:c';
    const res = makeResponse();
    const next = vi.fn() as NextFunction;

    requireGoogleAdsCsvAuth(requestWith(basic('u', 'a:b:c')), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
