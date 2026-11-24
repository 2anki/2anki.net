import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

import { useCardUsage } from './useCardUsage';

function buildWrapper() {
  const queryClient = new QueryClient();
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useCardUsage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports loading while the counts are on their way', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );

    const { result } = renderHook(() => useCardUsage(true), {
      wrapper: buildWrapper(),
    });

    expect(result.current).toEqual({
      cards_used: 0,
      cards_limit: 100,
      unlimited: false,
      loading: true,
    });
  });

  it.each([
    ['the network fails', () => Promise.reject(new TypeError('offline'))],
    [
      'the server answers 500',
      () =>
        Promise.resolve(
          new Response('{}', {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          })
        ),
    ],
  ])('stops loading when %s', async (_case, respond) => {
    vi.stubGlobal('fetch', vi.fn(respond));

    const { result } = renderHook(() => useCardUsage(true), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current?.loading).toBe(false));
    expect(result.current).toEqual({
      cards_used: 0,
      cards_limit: 100,
      unlimited: false,
      loading: false,
    });
  });

  it('returns nothing for a visitor with no session', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useCardUsage(false), {
      wrapper: buildWrapper(),
    });

    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
