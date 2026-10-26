import { vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { redirectLegacyDocs } from './redirectLegacyDocs';

function mockReqRes(path: string, originalUrl?: string) {
  const req = { path, originalUrl: originalUrl ?? path } as Request;
  const res = {
    redirect: vi.fn(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('redirectLegacyDocs', () => {
  it.each([
    ['/guides/introduction/', '/documentation/start-here/what-is-2anki/'],
    ['/features/pdf', '/documentation/reference/file-formats/'],
    [
      '/documentation/troubleshooting/faq',
      '/documentation/help/common-problems/',
    ],
    ['/links/anki/', 'https://apps.ankiweb.net/'],
  ])('301s %s to %s', (from, to) => {
    const { req, res, next } = mockReqRes(from);
    redirectLegacyDocs(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(301, to);
    expect(next).not.toHaveBeenCalled();
  });

  it('drops the query string, like the other canonicalization redirects', () => {
    const { req, res, next } = mockReqRes(
      '/features/zip/',
      '/features/zip/?ref=old'
    );
    redirectLegacyDocs(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(
      301,
      '/documentation/reference/file-formats/'
    );
  });

  it.each([
    '/documentation/help/common-problems/',
    '/documentation/misc/privacy-policy',
    '/upload',
    '/assets/app.js',
  ])('passes through %s', (path) => {
    const { req, res, next } = mockReqRes(path);
    redirectLegacyDocs(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
