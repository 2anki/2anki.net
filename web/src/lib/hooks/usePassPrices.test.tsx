import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('../backend/getPassPricing', () => ({
  getPassPricing: vi.fn(),
}));

import { getPassPricing } from '../backend/getPassPricing';
import { usePassPrices, useLivePassPrices } from './usePassPrices';

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('usePassPrices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the hardcoded fallback prices before the endpoint resolves', () => {
    vi.mocked(getPassPricing).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePassPrices(), {
      wrapper: buildWrapper(),
    });

    expect(result.current).toEqual({ '24h': '$6', '7d': '$12', '120d': '$29' });
  });

  it('reconciles to the live display strings once the endpoint resolves', async () => {
    vi.mocked(getPassPricing).mockResolvedValue({
      passes: {
        '24h': { amount: 700, currency: 'usd', display: '$7' },
        '7d': { amount: 1400, currency: 'usd', display: '$14' },
        '120d': { amount: 3200, currency: 'usd', display: '$32' },
      },
    });

    const { result } = renderHook(() => usePassPrices(), {
      wrapper: buildWrapper(),
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        '24h': '$7',
        '7d': '$14',
        '120d': '$32',
      })
    );
  });

  it('keeps the fallback for any pass the endpoint omits', async () => {
    vi.mocked(getPassPricing).mockResolvedValue({
      passes: {
        '7d': { amount: 1400, currency: 'usd', display: '$14' },
      },
    });

    const { result } = renderHook(() => usePassPrices(), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current['7d']).toBe('$14'));
    expect(result.current['24h']).toBe('$6');
    expect(result.current['120d']).toBe('$29');
  });

  it('keeps the fallback when the endpoint request fails', async () => {
    vi.mocked(getPassPricing).mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => usePassPrices(), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(getPassPricing).toHaveBeenCalled());
    expect(result.current).toEqual({ '24h': '$6', '7d': '$12', '120d': '$29' });
  });
});

describe('useLivePassPrices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns nothing before the endpoint resolves', () => {
    vi.mocked(getPassPricing).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useLivePassPrices(), {
      wrapper: buildWrapper(),
    });

    expect(result.current).toEqual({});
  });

  it('returns only the live display strings, never the fallback', async () => {
    vi.mocked(getPassPricing).mockResolvedValue({
      passes: {
        '24h': { amount: 700, currency: 'usd', display: '$7' },
        '120d': { amount: 3200, currency: 'usd', display: '$32' },
      },
    });

    const { result } = renderHook(() => useLivePassPrices(), {
      wrapper: buildWrapper(),
    });

    await waitFor(() =>
      expect(result.current).toEqual({ '24h': '$7', '120d': '$32' })
    );
  });

  it('omits a pass the endpoint does not return rather than filling it', async () => {
    vi.mocked(getPassPricing).mockResolvedValue({
      passes: {
        '24h': { amount: 700, currency: 'usd', display: '$7' },
      },
    });

    const { result } = renderHook(() => useLivePassPrices(), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current['24h']).toBe('$7'));
    expect(result.current['120d']).toBeUndefined();
  });

  it('returns nothing when the endpoint request fails', async () => {
    vi.mocked(getPassPricing).mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useLivePassPrices(), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(getPassPricing).toHaveBeenCalled());
    expect(result.current).toEqual({});
  });
});
