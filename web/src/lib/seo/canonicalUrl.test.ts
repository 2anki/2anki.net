import { describe, it, expect } from 'vitest';
import { canonicalUrl } from './canonicalUrl';

describe('canonicalUrl', () => {
  it('appends a trailing slash so hydration matches the prerendered head', () => {
    expect(canonicalUrl('/notion-to-anki')).toBe(
      'https://2anki.net/notion-to-anki/'
    );
  });

  it('leaves an existing trailing slash alone', () => {
    expect(canonicalUrl('/convert/')).toBe('https://2anki.net/convert/');
  });

  it('canonicalizes the root to the bare origin with a slash', () => {
    expect(canonicalUrl('/')).toBe('https://2anki.net/');
  });
});
