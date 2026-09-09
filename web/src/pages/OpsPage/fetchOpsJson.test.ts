import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { fetchOpsJson } from './fetchOpsJson';

describe('fetchOpsJson', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('sends credentials and returns the parsed body', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ rows: 3 }),
    });
    await expect(fetchOpsJson<{ rows: number }>('/api/ops/x')).resolves.toEqual(
      { rows: 3 }
    );
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/ops/x', {
      credentials: 'include',
    });
  });

  test('surfaces the server message on a non-ok response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ message: 'events table missing' }),
    });
    await expect(fetchOpsJson('/api/ops/x')).rejects.toThrow(
      'events table missing'
    );
  });

  test('falls back to the status line when the body is not JSON', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => {
        throw new Error('not json');
      },
    });
    await expect(fetchOpsJson('/api/ops/x')).rejects.toThrow('502 Bad Gateway');
  });
});
