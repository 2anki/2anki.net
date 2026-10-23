// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useBusinessMetrics } from './useBusinessMetrics';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };

describe('useBusinessMetrics', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({}),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('bypasses the browser HTTP cache so Refresh shows current numbers', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useBusinessMetrics(), {
      wrapper: wrap(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/business/metrics',
      expect.objectContaining({ cache: 'no-store' })
    );
  });
});
