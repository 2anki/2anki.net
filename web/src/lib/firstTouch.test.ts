import { describe, it, expect } from 'vitest';
import {
  buildFirstTouchCookie,
  captureFirstTouch,
  FIRST_TOUCH_COOKIE,
} from './firstTouch';

function decodeCookieValue(assignment: string): unknown {
  const value = assignment.split(';')[0].slice(`${FIRST_TOUCH_COOKIE}=`.length);
  return JSON.parse(decodeURIComponent(value));
}

describe('buildFirstTouchCookie', () => {
  it('captures the landing path and referrer hostname on first touch', () => {
    const cookie = buildFirstTouchCookie(
      '',
      '/pdf-to-anki',
      'https://chatgpt.com/share/abc?ref=1'
    );
    expect(cookie).not.toBeNull();
    expect(decodeCookieValue(cookie as string)).toEqual({
      landingPath: '/pdf-to-anki',
      referrer: 'chatgpt.com',
    });
    expect(cookie).toContain('Max-Age=1800');
    expect(cookie).toContain('Path=/');
  });

  it('stores an empty referrer when there is no document referrer', () => {
    const cookie = buildFirstTouchCookie('', '/', '');
    expect(decodeCookieValue(cookie as string)).toEqual({
      landingPath: '/',
      referrer: '',
    });
  });

  it('returns null when a first_touch cookie already exists (first touch wins)', () => {
    const existing = `${FIRST_TOUCH_COOKIE}=%7B%7D; other=1`;
    expect(buildFirstTouchCookie(existing, '/pricing', '')).toBeNull();
  });
});

describe('captureFirstTouch', () => {
  it('writes the cookie on the first visit', () => {
    const doc = {
      cookie: '',
      referrer: 'https://perplexity.ai/search',
      location: { pathname: '/quizlet-to-anki' },
    };
    captureFirstTouch(doc);
    expect(doc.cookie).toContain(`${FIRST_TOUCH_COOKIE}=`);
    const written = doc.cookie;
    expect(decodeCookieValue(written)).toEqual({
      landingPath: '/quizlet-to-anki',
      referrer: 'perplexity.ai',
    });
  });

  it('is a no-op on the second visit within the session', () => {
    const doc = {
      cookie: `${FIRST_TOUCH_COOKIE}=%7B%22landingPath%22%3A%22%2Ffirst%22%7D`,
      referrer: 'https://example.com',
      location: { pathname: '/second' },
    };
    captureFirstTouch(doc);
    expect(doc.cookie).toBe(
      `${FIRST_TOUCH_COOKIE}=%7B%22landingPath%22%3A%22%2Ffirst%22%7D`
    );
  });

  it('records the remembered landing path instead of the current one', () => {
    const doc = {
      cookie: '',
      referrer: '',
      location: { pathname: '/upload' },
    };
    captureFirstTouch(doc, '/pdf-to-anki/');
    expect(decodeCookieValue(doc.cookie)).toEqual({
      landingPath: '/pdf-to-anki/',
      referrer: '',
    });
  });
});
