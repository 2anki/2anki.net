import { vi, type Mock } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { noindexAuthPages } from './noindexAuthPages';

function run(
  path: string,
  existingRobotsTag?: string
): { setHeader: Mock; next: Mock } {
  const setHeader = vi.fn();
  const next = vi.fn();
  noindexAuthPages(
    { path } as Request,
    { setHeader, getHeader: () => existingRobotsTag } as unknown as Response,
    next as NextFunction
  );
  return { setHeader, next };
}

describe('noindexAuthPages', () => {
  it.each([
    '/login',
    '/register',
    '/forgot',
    '/auth/magic',
    '/account/email-change',
    '/login/',
    '/Register',
    '/users/r/3f9c1a7e5b2d',
    '/users/r/3f9c1a7e5b2d/',
    '/Users/R/3F9C1A7E5B2D',
  ])('tells crawlers to keep %s out of the index', (path) => {
    const { setHeader, next } = run(path);
    expect(setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'noindex');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    '/',
    '/upload',
    '/pricing',
    '/notion-to-anki',
    '/documentation/start-here/what-is-2anki',
    '/login-help',
    '/register/extra',
    '/api/users/login',
    '/api/users/r/3f9c1a7e5b2d',
    '/users/r',
    '/users/register',
  ])('leaves %s indexable', (path) => {
    const { setHeader, next } = run(path);
    expect(setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps the stricter header a preview host already set', () => {
    const { setHeader, next } = run('/login', 'noindex, nofollow');
    expect(setHeader).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
