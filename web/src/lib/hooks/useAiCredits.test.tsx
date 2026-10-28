import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('../backend/getAiCredits', () => ({ getAiCredits: vi.fn() }));
vi.mock('./useUserLocals', () => ({ useUserLocals: vi.fn() }));

import { AiCreditsResponse, getAiCredits } from '../backend/getAiCredits';
import { useUserLocals } from './useUserLocals';
import {
  AI_CREDITS_QUERY_KEY,
  useAiCredits,
  useAiCreditsRead,
} from './useAiCredits';

function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function buildWrapper(queryClient: QueryClient = newQueryClient()) {
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function signedInAs(id: number) {
  vi.mocked(useUserLocals).mockReturnValue({
    data: { user: { id } },
    isLoading: false,
    error: null,
    isError: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useUserLocals>);
}

function balance(credits: number): AiCreditsResponse {
  return {
    credits,
    used: 1500 - credits,
    allowance: 1500,
    usable: true,
    windowEnd: null,
    resets: 'pass',
  };
}

describe('useAiCredits', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    signedInAs(7);
  });

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
      used: 8,
      allowance: 300,
      usable: true,
      windowEnd: null,
      resets: 'period',
    });

    const { result } = renderHook(() => useAiCredits(true), {
      wrapper: buildWrapper(),
    });

    await waitFor(() =>
      expect(result.current).toEqual({
        credits: 42,
        used: 8,
        allowance: 300,
        usable: true,
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

  it("never shows a newly signed-in account the last account's balance", async () => {
    vi.mocked(getAiCredits).mockResolvedValueOnce(balance(1347));
    const { result, rerender } = renderHook(() => useAiCredits(true), {
      wrapper: buildWrapper(),
    });
    await waitFor(() => expect(result.current).toEqual(balance(1347)));

    let answerSecondAccount: (value: AiCreditsResponse) => void = () => {};
    vi.mocked(getAiCredits).mockReturnValueOnce(
      new Promise((resolve) => {
        answerSecondAccount = resolve;
      })
    );
    signedInAs(9);
    rerender();

    expect(result.current).toBeNull();
    await act(async () => answerSecondAccount(balance(12)));
    await waitFor(() => expect(result.current).toEqual(balance(12)));
    expect(getAiCredits).toHaveBeenCalledTimes(2);
  });

  it('reads the balance again when a spend site invalidates the credits key', async () => {
    vi.mocked(getAiCredits)
      .mockResolvedValueOnce(balance(1347))
      .mockResolvedValueOnce(balance(1335));
    const queryClient = newQueryClient();
    const { result } = renderHook(() => useAiCredits(true), {
      wrapper: buildWrapper(queryClient),
    });
    await waitFor(() => expect(result.current).toEqual(balance(1347)));

    await act(() =>
      queryClient.invalidateQueries({ queryKey: AI_CREDITS_QUERY_KEY })
    );

    await waitFor(() => expect(result.current).toEqual(balance(1335)));
  });
});

describe('useAiCreditsRead', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    signedInAs(7);
  });

  it('is not settled while the balance is still loading', () => {
    vi.mocked(getAiCredits).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAiCreditsRead(true), {
      wrapper: buildWrapper(),
    });

    expect(result.current).toEqual({ credits: null, settled: false });
  });

  it('is settled with no balance once a failed read has finished', async () => {
    vi.mocked(getAiCredits).mockResolvedValue(null);

    const { result } = renderHook(() => useAiCreditsRead(true), {
      wrapper: buildWrapper(),
    });

    await waitFor(() =>
      expect(result.current).toEqual({ credits: null, settled: true })
    );
  });

  it('is settled with the balance once the read answers', async () => {
    vi.mocked(getAiCredits).mockResolvedValue(balance(42));

    const { result } = renderHook(() => useAiCreditsRead(true), {
      wrapper: buildWrapper(),
    });

    await waitFor(() =>
      expect(result.current).toEqual({ credits: balance(42), settled: true })
    );
  });

  it('reads nothing and is not settled while disabled', () => {
    const { result } = renderHook(() => useAiCreditsRead(false), {
      wrapper: buildWrapper(),
    });

    expect(result.current).toEqual({ credits: null, settled: false });
    expect(getAiCredits).not.toHaveBeenCalled();
  });
});
