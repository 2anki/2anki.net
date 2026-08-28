import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('../backend/getSubscriptionStatus', () => ({
  getSubscriptionStatus: vi.fn(),
}));

import { getSubscriptionStatus } from '../backend/getSubscriptionStatus';
import { deriveView, useStripeSubscriptions } from './useStripeSubscriptions';

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

const active = {
  id: 'sub_active',
  status: 'active',
  created: 1_700_000_000,
  cancel_at_period_end: false,
  cancel_at: null,
  canceled_at: null,
  current_period_end: 1_800_000_000,
  paused_until: null,
  cancellation_reason: null,
  plan: null,
};

const second = { ...active, id: 'sub_second' };

const canceled = {
  ...active,
  id: 'sub_old',
  status: 'canceled',
};

describe('useStripeSubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes only the active subscriptions in activeSubscriptions', async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      subscriptions: [active, second, canceled],
    });

    const { result } = renderHook(() => useStripeSubscriptions(true), {
      wrapper: buildWrapper(),
    });

    await waitFor(() =>
      expect(result.current.activeSubscriptions).toHaveLength(2)
    );
    expect(result.current.activeSubscriptions.map((s) => s.id)).toEqual([
      'sub_active',
      'sub_second',
    ]);
  });

  it('keeps the single-sub view for back-compat', async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      subscriptions: [active],
    });

    const { result } = renderHook(() => useStripeSubscriptions(true), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current.view.kind).toBe('active'));
    expect(result.current.activeSubscriptions).toHaveLength(1);
  });

  it('derives the paused view when pause_collection is set', async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      subscriptions: [{ ...active, paused_until: 1_900_000_000 }],
    });

    const { result } = renderHook(() => useStripeSubscriptions(true), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current.view.kind).toBe('paused'));
  });

  it.each(['past_due', 'unpaid'])(
    'derives the past_due view for a %s subscription',
    async (status) => {
      vi.mocked(getSubscriptionStatus).mockResolvedValue({
        subscriptions: [{ ...active, id: 'sub_due', status }],
      });

      const { result } = renderHook(() => useStripeSubscriptions(true), {
        wrapper: buildWrapper(),
      });

      await waitFor(() => expect(result.current.view.kind).toBe('past_due'));
    }
  );

  it('keeps the active view when both an active and a past_due sub exist', async () => {
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      subscriptions: [active, { ...active, id: 'sub_due', status: 'past_due' }],
    });

    const { result } = renderHook(() => useStripeSubscriptions(true), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current.view.kind).toBe('active'));
  });

  it('exposes the query error state', async () => {
    vi.mocked(getSubscriptionStatus).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useStripeSubscriptions(true), {
      wrapper: buildWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.view.kind).toBe('none');
  });
});

describe('deriveView recently cancelled window', () => {
  const NOW_MS = Date.parse('2026-08-28T00:00:00Z');
  const nowSeconds = Math.floor(NOW_MS / 1000);
  const DAY = 24 * 60 * 60;

  it('returns the cancelled view when canceled within the last 30 days', () => {
    const view = deriveView(
      [{ ...canceled, canceled_at: nowSeconds - 5 * DAY }],
      NOW_MS
    );
    expect(view.kind).toBe('cancelled');
  });

  it('returns the none view when canceled more than 30 days ago', () => {
    const view = deriveView(
      [{ ...canceled, canceled_at: nowSeconds - 31 * DAY }],
      NOW_MS
    );
    expect(view.kind).toBe('none');
  });

  it('returns the none view when a canceled sub has no canceled_at', () => {
    const view = deriveView([{ ...canceled, canceled_at: null }], NOW_MS);
    expect(view.kind).toBe('none');
  });
});
