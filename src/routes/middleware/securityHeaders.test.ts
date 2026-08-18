import { Request, Response, NextFunction } from 'express';
import { securityHeaders } from './securityHeaders';

function mockReq(): Request {
  return {} as Request;
}

function mockRes(): { headers: Record<string, string>; setHeader: jest.Mock } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  };
}

describe('securityHeaders', () => {
  it('sets Strict-Transport-Security for one year including subdomains', () => {
    const res = mockRes();
    const next = jest.fn();
    securityHeaders(
      mockReq(),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.headers['Strict-Transport-Security']).toBe(
      'max-age=31536000; includeSubDomains'
    );
    expect(next).toHaveBeenCalled();
  });

  it('sets X-Content-Type-Options to nosniff', () => {
    const res = mockRes();
    const next = jest.fn();
    securityHeaders(
      mockReq(),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('sets Referrer-Policy to strict-origin-when-cross-origin', () => {
    const res = mockRes();
    const next = jest.fn();
    securityHeaders(
      mockReq(),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.headers['Referrer-Policy']).toBe(
      'strict-origin-when-cross-origin'
    );
  });
});
