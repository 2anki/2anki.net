import { describe, expect, it } from 'vitest';
import { ANSWERS_PAGES } from './answersConfig';

const URL_FOLLOWED_BY_PUNCTUATION = /https?:\/\/[^\s"']+[.,;:!?)](?=\s|"|$)/g;

describe('answers copy', () => {
  it('never puts punctuation right after a URL a reader might copy', () => {
    const text = JSON.stringify([...ANSWERS_PAGES.values()]).replaceAll(
      '\\"',
      '"'
    );
    expect(text.match(URL_FOLLOWED_BY_PUNCTUATION) ?? []).toEqual([]);
  });
});
