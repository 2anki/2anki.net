// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useActiveShares } from './useActiveShares';

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useActiveShares', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns the parsed share list from /api/shares', async () => {
    const shares = [
      {
        token: 't1',
        upload_key: 'uploads/a.apkg',
        url: 'https://2anki.net/s/t1',
        created_at: '2026-05-20T00:00:00Z',
        view_count: 4,
      },
    ];
    vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse(200, shares));

    const { result } = renderHook(() => useActiveShares(), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current).toHaveLength(1));
    expect(result.current[0].token).toBe('t1');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/shares',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it('returns an empty list when the request fails', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('', { status: 401 })
    );

    const { result } = renderHook(() => useActiveShares(), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it('returns an empty list before the request resolves', () => {
    vi.mocked(globalThis.fetch).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useActiveShares(), {
      wrapper: buildWrapper(),
    });

    expect(result.current).toEqual([]);
  });
});
