// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  aiPreviewCheckoutMarked,
  clearAiPreviewCheckout,
  markAiPreviewCheckout,
} from './aiPreviewCheckout';

describe('aiPreviewCheckout marker', () => {
  afterEach(() => clearAiPreviewCheckout());

  it('is unmarked by default', () => {
    expect(aiPreviewCheckoutMarked()).toBe(false);
  });

  it('is marked once a checkout starts and unmarked once cleared', () => {
    markAiPreviewCheckout();
    expect(aiPreviewCheckoutMarked()).toBe(true);

    clearAiPreviewCheckout();
    expect(aiPreviewCheckoutMarked()).toBe(false);
  });
});
