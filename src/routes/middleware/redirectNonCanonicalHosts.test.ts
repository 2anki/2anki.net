import { vi, type Mock } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { redirectNonCanonicalHosts } from './redirectNonCanonicalHosts';

function mockReq(host: string, originalUrl = '/'): Request {
  return { hostname: host, originalUrl } as Request;
}

function mockRes(): { redirect: Mock } {
  return { redirect: vi.fn() };
}

describe('redirectNonCanonicalHosts', () => {
  const originalCanonicalHost = process.env.CANONICAL_HOST;

  afterEach(() => {
    if (originalCanonicalHost == null) {
      delete process.env.CANONICAL_HOST;
    } else {
      process.env.CANONICAL_HOST = originalCanonicalHost;
    }
  });

  it('calls next without redirecting when CANONICAL_HOST is unset', () => {
    delete process.env.CANONICAL_HOST;
    const res = mockRes();
    const next = vi.fn();
    redirectNonCanonicalHosts(
      mockReq('www.2anki.net'),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('calls next without redirecting on the canonical apex host', () => {
    process.env.CANONICAL_HOST = '2anki.net';
    const res = mockRes();
    const next = vi.fn();
    redirectNonCanonicalHosts(
      mockReq('2anki.net', '/upload'),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('301-redirects www to the apex, preserving path and query', () => {
    process.env.CANONICAL_HOST = '2anki.net';
    const res = mockRes();
    const next = vi.fn();
    redirectNonCanonicalHosts(
      mockReq('www.2anki.net', '/upload?view=template'),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.redirect).toHaveBeenCalledWith(
      301,
      'https://2anki.net/upload?view=template'
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('301-redirects phantom subdomains to the apex', () => {
    process.env.CANONICAL_HOST = '2anki.net';
    for (const host of [
      'ww.2anki.net',
      'dev.2anki.net',
      '21.2anki.net',
      'd1ftjqlthet2543jvpm0.2anki.net',
    ]) {
      const res = mockRes();
      const next = vi.fn();
      redirectNonCanonicalHosts(
        mockReq(host, '/'),
        res as unknown as Response,
        next as NextFunction
      );
      expect(res.redirect).toHaveBeenCalledWith(301, 'https://2anki.net/');
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('never redirects off the canonical host for a crafted protocol-relative path', () => {
    process.env.CANONICAL_HOST = '2anki.net';
    const res = mockRes();
    const next = vi.fn();
    redirectNonCanonicalHosts(
      mockReq('www.2anki.net', '//evil.com'),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.redirect).toHaveBeenCalledWith(301, 'https://2anki.net/');
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next without redirecting on localhost (internal health probes)', () => {
    process.env.CANONICAL_HOST = '2anki.net';
    const res = mockRes();
    const next = vi.fn();
    redirectNonCanonicalHosts(
      mockReq('localhost', '/api/checks'),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('does not redirect unrelated domains that are not subdomains of the canonical host', () => {
    process.env.CANONICAL_HOST = '2anki.net';
    for (const host of ['example.com', '2anki.com', '127.0.0.1']) {
      const res = mockRes();
      const next = vi.fn();
      redirectNonCanonicalHosts(
        mockReq(host, '/'),
        res as unknown as Response,
        next as NextFunction
      );
      expect(res.redirect).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    }
  });

  it('calls next when the hostname is missing', () => {
    process.env.CANONICAL_HOST = '2anki.net';
    const res = mockRes();
    const next = vi.fn();
    redirectNonCanonicalHosts(
      mockReq('', '/'),
      res as unknown as Response,
      next as NextFunction
    );
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
