import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useSectionSummaries } from './useSectionSummary';

const wrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: queryClient }, children);
};

describe('useSectionSummaries', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        rows: [
          {
            id: 'new_paid_7d',
            lever: 'revenue',
            label: 'New paid',
            format: 'count',
            window_label: '7d',
            value: 15,
            delta: null,
            delta_good: null,
            target: 70,
            target_direction: 'at_least',
            status: 'red',
            link: '/ops/business',
          },
        ],
        as_of: '2026-09-09T10:00:00.000Z',
        cache_age_seconds: 0,
        stale: false,
        errors: [],
      }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns the snapshot row for a known id and null otherwise', async () => {
    const { result } = renderHook(() => useSectionSummaries(), { wrapper });
    await waitFor(() => expect(result.current('new_paid_7d')?.value).toBe(15));
    expect(result.current('missing')).toBeNull();
  });
});
