import { vi, type Mock } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { denyFraming } from './denyFraming';

function mockReq(): Request {
  return {} as Request;
}

function mockRes(): { headers: Record<string, string>; setHeader: Mock } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  };
}

describe('denyFraming', () => {
  it('sets X-Frame-Options to DENY', () => {
    const res = mockRes();
    const next = vi.fn();
    denyFraming(mockReq(), res as unknown as Response, next as NextFunction);
    expect(res.headers['X-Frame-Options']).toBe('DENY');
    expect(next).toHaveBeenCalled();
  });

  it('sets Content-Security-Policy frame-ancestors to none', () => {
    const res = mockRes();
    const next = vi.fn();
    denyFraming(mockReq(), res as unknown as Response, next as NextFunction);
    expect(res.headers['Content-Security-Policy']).toBe(
      "frame-ancestors 'none'"
    );
    expect(next).toHaveBeenCalled();
  });
});
