import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useUploadFunnel } from './useUploadFunnel';

const okResponse = (payload: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: async () => payload,
});

const wrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('useUploadFunnel', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test('fetches the requested window with credentials and returns the payload', async () => {
    const payload = {
      stages: {
        upload_started: 100,
        conversion_succeeded: 80,
        conversion_failed: 20,
        deck_downloaded: 60,
        paywall_shown: 40,
        signup: 30,
        paid: 6,
      },
      upload_to_download_rate_pct: 60,
      download_to_signup_rate_pct: 50,
      download_to_paid_rate_pct: 10,
      since: '2026-05-01T00:00:00.000Z',
      as_of: '2026-05-30T00:00:00.000Z',
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      okResponse(payload)
    );

    const { result } = renderHook(() => useUploadFunnel('7d'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(payload));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/ops/upload-funnel?window=7d',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  test('surfaces the server message when the response is not ok', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ message: 'Failed to load upload funnel' }),
    });

    const { result } = renderHook(() => useUploadFunnel('30d'), { wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('Failed to load upload funnel');
  });
});
