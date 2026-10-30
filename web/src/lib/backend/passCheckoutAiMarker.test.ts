// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { Backend } from './Backend';
import {
  aiPreviewCheckoutMarked,
  clearAiPreviewCheckout,
  markAiPreviewCheckout,
} from '../../components/AiPreviewGate/aiPreviewCheckout';

vi.mock('./api', () => ({
  del: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  getLoginURL: vi.fn(),
  redirectToLogin: vi.fn(),
}));

describe('a pass checkout and the AI preview marker', () => {
  beforeEach(() => {
    vi.mocked(api.post)
      .mockReset()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ url: 'https://stripe/s' }),
      } as unknown as Response);
    markAiPreviewCheckout();
  });

  afterEach(() => {
    clearAiPreviewCheckout();
  });

  it.each([['upload-limit-wall'], ['pricing'], [undefined]])(
    'forgets an earlier AI preview checkout when the pass is bought from %s',
    async (surface) => {
      await new Backend().startPassCheckout('24h', undefined, surface);

      expect(aiPreviewCheckoutMarked()).toBe(false);
    }
  );

  it('keeps the marker for a checkout started from the AI preview', async () => {
    await new Backend().startPassCheckout('24h', undefined, 'ai-preview');

    expect(aiPreviewCheckoutMarked()).toBe(true);
  });
});
