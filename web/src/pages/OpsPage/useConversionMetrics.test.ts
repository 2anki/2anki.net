import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useConversionMetrics } from './useConversionMetrics';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };

describe('useConversionMetrics', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('calls /api/ops/conversion/metrics with credentials and returns the payload', async () => {
    const payload = {
      free_conversions_7d: 10,
      paid_conversions_7d: 2,
      free_conversion_success_rate_7d: 80,
      paid_conversion_success_rate_7d: 95,
      free_blocked_by_plan_7d: 12,
      paid_blocked_by_plan_7d: 0,
      conversion_errors_7d_top_reasons: [],
      failed_conversions_weekly: [],
      new_accounts_downloaded_24h_rate_30d: 54.4,
      new_accounts_downloaded_after_signup_24h_rate_30d: 11.7,
      upload_to_download_rate_7d: 25,
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => payload,
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useConversionMetrics(), {
      wrapper: wrap(client),
    });

    await waitFor(() => expect(result.current.data).toEqual(payload));

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/conversion/metrics',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  test('surfaces a thrown error when the response is not ok', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    });

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useConversionMetrics(), {
      wrapper: wrap(client),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('500 Internal Server Error');
  });
});
