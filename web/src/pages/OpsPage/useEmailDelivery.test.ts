import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactNode } from 'react';

import { useEmailDelivery } from './useEmailDelivery';
import { EmailDeliveryResponse } from './emailDeliveryTypes';

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const sample: EmailDeliveryResponse = {
  window: '7d',
  by_category: [],
};

describe('useEmailDelivery', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => sample })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('fetches the endpoint for the requested window with credentials', async () => {
    const { result } = renderHook(() => useEmailDelivery('7d'), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(sample);
    expect(fetch).toHaveBeenCalledWith(
      '/api/ops/email-delivery?window=7d',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  test('surfaces a non-ok response as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })
    );

    const { result } = renderHook(() => useEmailDelivery('30d'), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('404 Not Found');
  });
});
