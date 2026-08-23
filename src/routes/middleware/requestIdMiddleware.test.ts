import { Request, Response, NextFunction } from 'express';
import { requestIdMiddleware } from './requestIdMiddleware';

function run(headers: Record<string, string | string[]> = {}) {
  const req = { headers } as unknown as Request;
  const setHeader = jest.fn();
  const res = { locals: {}, setHeader } as unknown as Response;
  const next = jest.fn() as NextFunction;
  requestIdMiddleware(req, res, next);
  return { res, setHeader, next };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('requestIdMiddleware', () => {
  it('mints a UUID, stores it in res.locals, and echoes the header', () => {
    const { res, setHeader, next } = run();

    expect(res.locals.requestId).toMatch(UUID_RE);
    expect(setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      res.locals.requestId
    );
    expect(next).toHaveBeenCalled();
  });

  it('honors a UUID-shaped inbound X-Request-Id', () => {
    const inbound = '123E4567-E89B-42D3-A456-426614174000';
    const { res } = run({ 'x-request-id': inbound });

    expect(res.locals.requestId).toBe(inbound.toLowerCase());
  });

  it.each([
    ['not-a-uuid'],
    ['../../etc/passwd'],
    ['123e4567e89b42d3a456426614174000'],
  ])('replaces a malformed inbound id %s with a fresh UUID', (inbound) => {
    const { res } = run({ 'x-request-id': inbound });

    expect(res.locals.requestId).not.toBe(inbound);
    expect(res.locals.requestId).toMatch(UUID_RE);
  });

  it('ignores an array-valued header', () => {
    const { res } = run({
      'x-request-id': ['123e4567-e89b-42d3-a456-426614174000'],
    });

    expect(res.locals.requestId).toMatch(UUID_RE);
    expect(res.locals.requestId).not.toBe(
      '123e4567-e89b-42d3-a456-426614174000'
    );
  });
});
