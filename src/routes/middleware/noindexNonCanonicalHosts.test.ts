import { vi, type Mock } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { noindexNonCanonicalHosts } from './noindexNonCanonicalHosts';

function mockReq(host: string): Request {
  return { hostname: host } as Request;
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

describe('noindexNonCanonicalHosts', () => {
  it('does not add X-Robots-Tag on the canonical apex host', () => {
    const res = mockRes();
    const next = vi.fn();
    noindexNonCanonicalHosts(
      mockReq('2anki.net'),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('adds noindex on the www host, which is not canonical', () => {
    const res = mockRes();
    const next = vi.fn();
    noindexNonCanonicalHosts(
      mockReq('www.2anki.net'),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Robots-Tag',
      'noindex, nofollow'
    );
    expect(next).toHaveBeenCalled();
  });

  it('adds noindex, nofollow on a preview subdomain', () => {
    const res = mockRes();
    const next = vi.fn();
    noindexNonCanonicalHosts(
      mockReq('dev.2anki.net'),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'X-Robots-Tag',
      'noindex, nofollow'
    );
    expect(next).toHaveBeenCalled();
  });

  it('adds noindex on random scraped subdomains like ww.2anki.net or 21.2anki.net', () => {
    for (const host of [
      'ww.2anki.net',
      '21.2anki.net',
      'beta.2anki.net',
      'cxa.2anki.net',
    ]) {
      const res = mockRes();
      const next = vi.fn();
      noindexNonCanonicalHosts(
        mockReq(host),
        res as unknown as Response,
        next as NextFunction
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Robots-Tag',
        'noindex, nofollow'
      );
      expect(next).toHaveBeenCalled();
    }
  });

  it('still calls next when hostname is missing', () => {
    const res = mockRes();
    const next = vi.fn();
    noindexNonCanonicalHosts(
      mockReq(''),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
