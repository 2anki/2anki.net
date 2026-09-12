import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { pruneDeadUploads } from './pruneDeadUploads';

describe('pruneDeadUploads', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('POSTs dryRun true and returns the missing count with sample keys', async () => {
    const payload = {
      dryRun: true,
      missingRows: 3,
      sampleKeys: ['decks/a.apkg', 'decks/b.apkg'],
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(payload),
    });

    const result = await pruneDeadUploads(true);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/prune-dead-uploads',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      }
    );
    expect(result).toEqual(payload);
  });

  test('POSTs dryRun false for a real prune and returns the deleted count', async () => {
    const payload = { dryRun: false, deleted: 3 };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(payload),
    });

    const result = await pruneDeadUploads(false);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/prune-dead-uploads',
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false }),
      }
    );
    expect(result).toEqual(payload);
  });

  test('throws the server message on a non-ok response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.resolve({ message: 'Failed to prune dead uploads' }),
    });

    await expect(pruneDeadUploads(true)).rejects.toThrow(
      'Failed to prune dead uploads'
    );
  });

  test('falls back to status text when the error body has no message', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.reject(new Error('no body')),
    });

    await expect(pruneDeadUploads(false)).rejects.toThrow('404 Not Found');
  });
});
