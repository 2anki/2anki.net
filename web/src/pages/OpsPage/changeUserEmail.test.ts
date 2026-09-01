import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { changeUserEmail } from './changeUserEmail';

describe('changeUserEmail', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('POSTs the current and new email and returns the account id', async () => {
    const payload = { userId: 42 };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(payload),
    });

    const result = await changeUserEmail('old@example.com', 'new@example.com');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/change-user-email',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentEmail: 'old@example.com',
          newEmail: 'new@example.com',
        }),
      }
    );
    expect(result).toEqual(payload);
  });

  test('surfaces the server message when the new email is taken', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: () =>
        Promise.resolve({
          message: 'Another account already uses that email.',
        }),
    });

    await expect(
      changeUserEmail('old@example.com', 'taken@example.com')
    ).rejects.toThrow('Another account already uses that email.');
  });
});
