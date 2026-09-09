import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useTodaySnapshot } from './useTodaySnapshot';

const wrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useTodaySnapshot', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('fetches the today snapshot with credentials under an ops- key', async () => {
    const payload = {
      rows: [],
      as_of: '2026-09-09T10:00:00.000Z',
      cache_age_seconds: 0,
      stale: false,
      errors: [],
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => payload,
    });

    const { result } = renderHook(() => useTodaySnapshot(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(payload));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/today',
      expect.objectContaining({ credentials: 'include' })
    );
  });
});
