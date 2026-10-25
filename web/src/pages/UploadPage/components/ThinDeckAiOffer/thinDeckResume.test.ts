// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
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
});
