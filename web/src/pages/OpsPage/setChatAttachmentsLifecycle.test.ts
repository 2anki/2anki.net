import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { setChatAttachmentsLifecycle } from './setChatAttachmentsLifecycle';

describe('setChatAttachmentsLifecycle', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('POSTs to the lifecycle endpoint and returns the applied rule', async () => {
    const payload = { ruleId: 'expire-chat-attachments-90d', ruleCount: 2 };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(payload),
    });

    const result = await setChatAttachmentsLifecycle();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/chat-attachments-lifecycle',
      { method: 'POST', credentials: 'include' }
    );
    expect(result).toEqual(payload);
  });

  test('throws the server message on a non-ok response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () =>
        Promise.resolve({ message: 'Failed to apply the lifecycle rule' }),
    });

    await expect(setChatAttachmentsLifecycle()).rejects.toThrow(
      'Failed to apply the lifecycle rule'
    );
  });

  test('falls back to status text when the error body has no message', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.reject(new Error('no body')),
    });

    await expect(setChatAttachmentsLifecycle()).rejects.toThrow(
      '404 Not Found'
    );
  });
});
