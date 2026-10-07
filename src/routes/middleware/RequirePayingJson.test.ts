import { vi } from 'vitest';
import express from 'express';

import RequirePayingJson from './RequirePayingJson';

function makeResponse(locals: Record<string, unknown>) {
  const res = {
    locals,
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as express.Response & {
    statusCode: number;
    body: unknown;
  };
}

describe('RequirePayingJson', () => {
  it('returns 401 JSON when there is no signed-in owner', () => {
    const res = makeResponse({ subscriber: true });
    const next = vi.fn();

    RequirePayingJson({} as express.Request, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 402 JSON when the signed-in user is not paying', () => {
    const res = makeResponse({ owner: 42, subscriber: false, patreon: false });
    const next = vi.fn();

    RequirePayingJson({} as express.Request, res, next);

    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({ error: 'upgrade required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when the signed-in user is a paying subscriber', () => {
    const res = makeResponse({ owner: 42, subscriber: true });
    const next = vi.fn();

    RequirePayingJson({} as express.Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next when the signed-in user is a lifetime patreon', () => {
    const res = makeResponse({ owner: 42, patreon: true });
    const next = vi.fn();

    RequirePayingJson({} as express.Request, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
