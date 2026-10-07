import { vi } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { redirectConvertDuplicates } from './redirectConvertDuplicates';

function mockReqRes(path: string, originalUrl?: string) {
  const req = { path, originalUrl: originalUrl ?? path } as Request;
  const res = {
    redirect: vi.fn(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('redirectConvertDuplicates', () => {
  it.each([
    ['/convert/notion-to-anki', '/notion-to-anki'],
    ['/convert/pdf-to-anki', '/pdf-to-anki'],
    ['/convert/markdown-to-anki', '/markdown-to-anki'],
  ])('301s %s to its bare twin %s', (from, to) => {
    const { req, res, next } = mockReqRes(from);
    redirectConvertDuplicates(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(301, to);
    expect(next).not.toHaveBeenCalled();
  });

  it('redirects to the bare canonical path, dropping any query string', () => {
    const { req, res, next } = mockReqRes(
      '/convert/pdf-to-anki',
      '/convert/pdf-to-anki?ref=ai'
    );
    redirectConvertDuplicates(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith(301, '/pdf-to-anki');
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    '/convert/csv-to-anki',
    '/convert/html-to-anki',
    '/convert/apkg-to-csv',
    '/convert/notion-tables-to-anki',
  ])('passes through %s — a /convert/ page with no bare twin', (path) => {
    const { req, res, next } = mockReqRes(path);
    redirectConvertDuplicates(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it.each([
    '/notion-to-anki',
    '/pdf-to-anki',
    '/markdown-to-anki',
    '/upload',
    '/pricing',
    '/assets/app.js',
  ])('passes through the canonical or unrelated path %s', (path) => {
    const { req, res, next } = mockReqRes(path);
    redirectConvertDuplicates(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
