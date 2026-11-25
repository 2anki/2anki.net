import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useCardUsage } from './useCardUsage';
import { useCardCountsUnknown } from './useCardCountsUnknown';

function stubFetch(answerUsage: () => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url === '/api/users/usage') return answerUsage();
      return Promise.resolve(
        new Response(JSON.stringify({ locals: {}, user: { id: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    })
  );
}

function renderBoth() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return renderHook(
    () => ({ usage: useCardUsage(true), unknown: useCardCountsUnknown(1) }),
    { wrapper }
  );
}

describe('useCardCountsUnknown', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tells a failed counts read apart, while useCardUsage still answers 0 of 100 as before', async () => {
    stubFetch(() => Promise.reject(new TypeError('offline')));

    const { result } = renderBoth();

    await waitFor(() => expect(result.current.unknown).toBe(true));
    expect(result.current.usage).toEqual({
      cards_used: 0,
      cards_limit: 100,
      unlimited: false,
      loading: false,
    });
  });

  it('is false once real counts arrive, even with nothing used', async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ cards_used: 0, cards_limit: 100, unlimited: false }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    const { result } = renderBoth();

    await waitFor(() => expect(result.current.usage?.loading).toBe(false));
    expect(result.current.unknown).toBe(false);
  });

  it('is false while the counts are still on their way', () => {
    stubFetch(() => new Promise(() => {}));

    const { result } = renderBoth();

    expect(result.current.unknown).toBe(false);
  });
});
