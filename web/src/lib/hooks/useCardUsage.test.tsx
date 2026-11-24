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

function stubFetch(answerUsage: () => Promise<Response>) {
  const fetchMock = vi.fn((url: string) => {
    if (url === '/api/users/usage') return answerUsage();
    return Promise.resolve(
      new Response(JSON.stringify({ locals: {}, user: { id: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const usageRequests = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([url]) => url === '/api/users/usage');

describe('useCardUsage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports loading while the counts are on their way', () => {
    stubFetch(() => new Promise(() => {}));

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
    stubFetch(respond);

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

  it('returns nothing and asks for no counts when the caller turns counts off', () => {
    const fetchMock = stubFetch(() => new Promise(() => {}));

    const { result } = renderHook(() => useCardUsage(false), {
      wrapper: buildWrapper(),
    });

    expect(result.current).toBeNull();
    expect(usageRequests(fetchMock)).toHaveLength(0);
  });
});
