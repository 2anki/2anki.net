import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { sendPassWinback } from './sendPassWinback';

describe('sendPassWinback', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('POSTs the campaign and dryRun true and returns the candidate count', async () => {
    const payload = { campaign: 'winback-2026-fall', count: 12, dryRun: true };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(payload),
    });

    const result = await sendPassWinback('winback-2026-fall', true);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/send-pass-winback?campaign=winback-2026-fall&dryRun=true',
      { method: 'POST', credentials: 'include' }
    );
    expect(result).toEqual(payload);
  });

  test('POSTs dryRun false for a real send and returns the sent count', async () => {
    const payload = { campaign: 'winback-2026-fall', count: 12, dryRun: false };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(payload),
    });

    const result = await sendPassWinback('winback-2026-fall', false);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/send-pass-winback?campaign=winback-2026-fall&dryRun=false',
      { method: 'POST', credentials: 'include' }
    );
    expect(result).toEqual(payload);
  });

  test('encodes campaign identifiers that contain URL-reserved characters', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () =>
        Promise.resolve({ campaign: 'a b&c', count: 0, dryRun: true }),
    });

    await sendPassWinback('a b&c', true);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/send-pass-winback?campaign=a%20b%26c&dryRun=true',
      { method: 'POST', credentials: 'include' }
    );
  });

  test('throws the server message on a non-ok response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: () => Promise.resolve({ message: 'campaign is required' }),
    });

    await expect(sendPassWinback('', true)).rejects.toThrow(
      'campaign is required'
    );
  });

  test('falls back to status text when the error body has no message', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: () => Promise.reject(new Error('no body')),
    });

    await expect(sendPassWinback('winback-2026-fall', false)).rejects.toThrow(
      '404 Not Found'
    );
  });
});
