import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useLandingPageYield } from './useLandingPageYield';

const wrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useLandingPageYield', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('fetches the requested window with credentials', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ as_of: '2026-06-30T00:00:00.000Z' }),
    });

    const { result } = renderHook(() => useLandingPageYield('90d'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).not.toBeUndefined());
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/growth/landing-page-yield?window=90d',
      expect.objectContaining({ credentials: 'include' })
    );
  });
});
