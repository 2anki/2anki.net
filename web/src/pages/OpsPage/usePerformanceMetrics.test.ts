import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { usePerformanceMetrics } from './usePerformanceMetrics';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };

const noRetryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('usePerformanceMetrics', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('parses a valid JSON body into the payload', async () => {
    const payload = {
      generated_at: '2026-07-05T09:00:00.000Z',
      durations: [],
      status_breakdown_24h: [],
      slowest_jobs_24h: [],
      signup_countries_7d: [],
      user_visible_errors_24h: [],
      user_visible_errors_7d: [],
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(payload),
    });

    const { result } = renderHook(() => usePerformanceMetrics(), {
      wrapper: wrap(noRetryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(payload);
  });

  test('bypasses the browser HTTP cache on every request', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '{}',
    });

    const { result } = renderHook(() => usePerformanceMetrics(), {
      wrapper: wrap(noRetryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/performance/metrics',
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  test('surfaces a clean error when a 200 has an empty body', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '',
    });

    const { result } = renderHook(() => usePerformanceMetrics(), {
      wrapper: wrap(noRetryClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('empty response body');
  });

  test('surfaces a clean error when a 200 body is not JSON', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => '<html>gateway timeout</html>',
    });

    const { result } = renderHook(() => usePerformanceMetrics(), {
      wrapper: wrap(noRetryClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('malformed response body');
  });

  test('aborts and surfaces a timeout error when the request hangs', async () => {
    vi.useFakeTimers();
    try {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            );
          })
      );

      const { result } = renderHook(() => usePerformanceMetrics(), {
        wrapper: wrap(noRetryClient()),
      });

      await vi.advanceTimersByTimeAsync(20_000);
      await vi.waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe('request timed out after 20s');
    } finally {
      vi.useRealTimers();
    }
  }, 10_000);

  test('surfaces status text on a non-ok response', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => '{"message":"Failed to load performance metrics"}',
    });

    const { result } = renderHook(() => usePerformanceMetrics(), {
      wrapper: wrap(noRetryClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('500 Internal Server Error');
  });
});
