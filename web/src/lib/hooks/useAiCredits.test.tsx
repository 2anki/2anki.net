import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('../backend/getAiCredits', () => ({ getAiCredits: vi.fn() }));

import { getAiCredits } from '../backend/getAiCredits';
import { useAiCredits } from './useAiCredits';

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useAiCredits', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null and does not fetch while disabled', () => {
    const { result } = renderHook(() => useAiCredits(false), {
      wrapper: buildWrapper(),
    });

    expect(result.current).toBeNull();
    expect(getAiCredits).not.toHaveBeenCalled();
  });

  it('returns the balance once the query resolves', async () => {
    vi.mocked(getAiCredits).mockResolvedValue({
      credits: 42,
      allowance: 300,
      windowEnd: null,
      resets: 'period',
    });

    const { result } = renderHook(() => useAiCredits(true), {
      wrapper: buildWrapper(),
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        credits: 42,
        allowance: 300,
        windowEnd: null,
        resets: 'period',
      })
    );
  });

  it('stays null when the fetch resolves null', async () => {
    vi.mocked(getAiCredits).mockResolvedValue(null);

    const { result } = renderHook(() => useAiCredits(true), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(getAiCredits).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
