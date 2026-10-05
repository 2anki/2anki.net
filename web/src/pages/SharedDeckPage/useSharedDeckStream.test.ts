// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useSharedDeckMeta, useSharedDeckStream } from './useSharedDeckStream';

vi.mock('../../lib/backend/getSharedDeck', () => ({
  getSharedDeckMeta: vi.fn(),
  getSharedDeckBatch: vi.fn(),
}));

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useSharedDeckMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fetch when token is undefined', async () => {
    const { getSharedDeckMeta } =
      await import('../../lib/backend/getSharedDeck');

    const { result } = renderHook(() => useSharedDeckMeta(undefined), {
      wrapper: buildWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getSharedDeckMeta).not.toHaveBeenCalled();
  });

  it('does not fetch when token is the empty string', async () => {
    const { getSharedDeckMeta } =
      await import('../../lib/backend/getSharedDeck');

    const { result } = renderHook(() => useSharedDeckMeta(''), {
      wrapper: buildWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getSharedDeckMeta).not.toHaveBeenCalled();
  });

  it('fetches the meta when token is present', async () => {
    const { getSharedDeckMeta } =
      await import('../../lib/backend/getSharedDeck');
    vi.mocked(getSharedDeckMeta).mockResolvedValue({
      totalCards: 7,
      decks: [{ id: 1, fullName: 'Anatomy', path: ['Anatomy'], cardCount: 7 }],
    });

    const { result } = renderHook(() => useSharedDeckMeta('tok'), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSharedDeckMeta).toHaveBeenCalledWith('tok');
    expect(result.current.data?.totalCards).toBe(7);
  });
});

describe('useSharedDeckStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fetch when token is undefined', async () => {
    const { getSharedDeckBatch } =
      await import('../../lib/backend/getSharedDeck');

    const { result } = renderHook(() => useSharedDeckStream(undefined), {
      wrapper: buildWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getSharedDeckBatch).not.toHaveBeenCalled();
  });

  it('passes deckId through to the batch fetcher', async () => {
    const { getSharedDeckBatch } =
      await import('../../lib/backend/getSharedDeck');
    vi.mocked(getSharedDeckBatch).mockResolvedValue({
      cards: [],
      nextCursor: null,
      total: 0,
    });

    const { result } = renderHook(() => useSharedDeckStream('tok', 42), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSharedDeckBatch).toHaveBeenCalledWith('tok', null, {
      deckId: 42,
    });
  });
});
