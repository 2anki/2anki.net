import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';

import { formatAge, isOpsQuery, useOpsFreshness } from './useOpsFreshness';

describe('formatAge', () => {
  test.each([
    [null, '—'],
    [0, 'just now'],
    [999, 'just now'],
    [4_000, '4s ago'],
    [59_999, '59s ago'],
    [60_000, '1m ago'],
    [3_599_999, '59m ago'],
    [3_600_000, '1h ago'],
    [7_200_000, '2h ago'],
  ])('formats %s as %s', (ageMs, expected) => {
    expect(formatAge(ageMs)).toBe(expected);
  });
});

describe('useOpsFreshness', () => {
  const makeClient = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const wrapperFor =
    (queryClient: QueryClient) =>
    ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

  test('reports no age until an ops query has data', () => {
    const queryClient = makeClient();
    const { result } = renderHook(() => useOpsFreshness(), {
      wrapper: wrapperFor(queryClient),
    });
    expect(result.current.ageMs).toBeNull();
    expect(result.current.fetching).toBe(false);
  });

  test('tracks the most recent ops query update', async () => {
    const queryClient = makeClient();
    const { result } = renderHook(() => useOpsFreshness(), {
      wrapper: wrapperFor(queryClient),
    });
    act(() => {
      queryClient.setQueryData(['ops-business-metrics'], { mrr_usd: 1 });
    });
    await waitFor(() => expect(result.current.ageMs).not.toBeNull());
    expect(result.current.ageMs).toBeLessThan(5_000);
  });

  test('refresh refetches active ops queries and leaves other queries alone', async () => {
    const queryClient = makeClient();
    const opsFetch = vi.fn().mockResolvedValue({ ok: true });
    const otherFetch = vi.fn().mockResolvedValue({ ok: true });
    const { result } = renderHook(
      () => {
        useQuery({
          queryKey: ['ops-upload-funnel', '30d'],
          queryFn: opsFetch,
          staleTime: Infinity,
        });
        useQuery({
          queryKey: ['subscriptions'],
          queryFn: otherFetch,
          staleTime: Infinity,
        });
        return useOpsFreshness();
      },
      { wrapper: wrapperFor(queryClient) }
    );
    await waitFor(() => expect(opsFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(otherFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.fetching).toBe(false));

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(opsFetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.fetching).toBe(false));
    expect(otherFetch).toHaveBeenCalledTimes(1);
  });

  test('isOpsQuery matches only ops-prefixed keys', () => {
    const queryClient = makeClient();
    queryClient.setQueryData(['ops-errors'], []);
    queryClient.setQueryData(['subscriptions'], []);
    const [ops, other] = queryClient.getQueryCache().getAll();
    expect(isOpsQuery(ops)).toBe(true);
    expect(isOpsQuery(other)).toBe(false);
  });
});
