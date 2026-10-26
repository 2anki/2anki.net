// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { hasSessionHint } from './sessionHint';

describe('hasSessionHint', () => {
  afterEach(() => {
    delete document.documentElement.dataset.auth;
  });

  it('is true when the server marked the page as signed in', () => {
    document.documentElement.dataset.auth = '1';
    expect(hasSessionHint()).toBe(true);
  });

  it('is false on an unmarked page', () => {
    expect(hasSessionHint()).toBe(false);
  });
});
