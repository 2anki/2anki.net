import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('../backend/getLandingConfig', () => ({
  getLandingConfig: vi.fn(),
}));

import { getLandingConfig } from '../backend/getLandingConfig';
import { useLandingPassPricesEnabled } from './useLandingPassPrices';

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useLandingPassPricesEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays off before the endpoint resolves', () => {
    vi.mocked(getLandingConfig).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useLandingPassPricesEnabled(), {
      wrapper: buildWrapper(),
    });

    expect(result.current).toBe(false);
  });

  it('turns on once the endpoint reports the flag is on', async () => {
    vi.mocked(getLandingConfig).mockResolvedValue({ showPassPrices: true });

    const { result } = renderHook(() => useLandingPassPricesEnabled(), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays off when the endpoint request fails', async () => {
    vi.mocked(getLandingConfig).mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useLandingPassPricesEnabled(), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(getLandingConfig).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
