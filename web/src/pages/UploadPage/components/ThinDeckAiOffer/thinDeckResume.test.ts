// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  THIN_DECK_RESUME_MAX_AGE_MS,
  clearThinDeckResume,
  markThinDeckResume,
  thinDeckResumeMarked,
} from './thinDeckResume';

describe('thinDeckResume', () => {
  beforeEach(() => clearThinDeckResume());

  it('is unmarked until the person heads to checkout', () => {
    expect(thinDeckResumeMarked()).toBe(false);
  });

  it('stays marked until it is cleared', () => {
    markThinDeckResume();

    expect(thinDeckResumeMarked()).toBe(true);

    clearThinDeckResume();

    expect(thinDeckResumeMarked()).toBe(false);
  });

  it('forgets a marker left behind by an abandoned checkout', () => {
    markThinDeckResume(1_000);

    expect(thinDeckResumeMarked(1_000 + THIN_DECK_RESUME_MAX_AGE_MS + 1)).toBe(
      false
    );
    expect(thinDeckResumeMarked(1_000)).toBe(false);
  });
});
