import type { Request } from 'express';
import { anonIdCookie } from './anonIdCookie';

function requestWith(cookies: unknown): Request {
  return { cookies } as unknown as Request;
}

describe('anonIdCookie', () => {
  it('returns the anon_id cookie value', () => {
    expect(anonIdCookie(requestWith({ anon_id: 'visitor-1' }))).toBe(
      'visitor-1'
    );
  });

  it.each([
    ['no cookies', undefined],
    ['an empty value', { anon_id: '' }],
    ['a non-string value', { anon_id: 42 }],
  ])('returns null for %s', (_label, cookies) => {
    expect(anonIdCookie(requestWith(cookies))).toBeNull();
  });
});
