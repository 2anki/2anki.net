import type express from 'express';

import { hasSessionCookie } from './sessionHint';

function requestWithCookies(cookies: unknown): express.Request {
  return { cookies } as unknown as express.Request;
}

describe('hasSessionCookie', () => {
  it('is true when the token cookie carries a value', () => {
    expect(hasSessionCookie(requestWithCookies({ token: 'abc' }))).toBe(true);
  });

  it.each([
    ['no cookie parser ran', undefined],
    ['no token cookie', { cookie_consent: 'granted' }],
    ['an empty token', { token: '' }],
    ['a non-string token', { token: 1 }],
  ])('is false with %s', (_label, cookies) => {
    expect(hasSessionCookie(requestWithCookies(cookies))).toBe(false);
  });
});
