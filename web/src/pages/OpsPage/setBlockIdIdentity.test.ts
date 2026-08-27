import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { setBlockIdIdentity } from './setBlockIdIdentity';

describe('setBlockIdIdentity', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('POSTs the email and enabled flag and returns the account state', async () => {
    const payload = { userId: 21, blockIdIdentity: true };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(payload),
    });

    const result = await setBlockIdIdentity('learner@example.com', true);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/set-block-id-identity',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'learner@example.com', enabled: true }),
      }
    );
    expect(result).toEqual(payload);
  });

  test('surfaces the server message when the account is missing', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () =>
        Promise.resolve({ message: 'No account found for that email.' }),
    });

    await expect(
      setBlockIdIdentity('nobody@example.com', false)
    ).rejects.toThrow('No account found for that email.');
  });
});
