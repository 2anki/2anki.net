// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('../../../lib/backend/cancelSubscription', () => ({
  cancelSubscriptionById: vi.fn(),
}));

import { cancelSubscriptionById } from '../../../lib/backend/cancelSubscription';
import { usePerSubscriptionCancellation } from './usePerSubscriptionCancellation';

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('usePerSubscriptionCancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens one confirm panel at a time', () => {
    const { result } = renderHook(() => usePerSubscriptionCancellation(), {
      wrapper: buildWrapper(),
    });

    act(() => result.current.openConfirm('sub_a'));
    expect(result.current.confirmingSubId).toBe('sub_a');

    act(() => result.current.openConfirm('sub_b'));
    expect(result.current.confirmingSubId).toBe('sub_b');

    act(() => result.current.dismissConfirm());
    expect(result.current.confirmingSubId).toBeNull();
  });

  it('cancels the targeted subscription immediately and refetches', async () => {
    vi.mocked(cancelSubscriptionById).mockResolvedValue({ message: 'ok' });
    const onSuccess = vi.fn();

    const { result } = renderHook(
      () => usePerSubscriptionCancellation(onSuccess),
      { wrapper: buildWrapper() }
    );

    act(() => result.current.confirmCancel('sub_owned'));

    await waitFor(() =>
      expect(cancelSubscriptionById).toHaveBeenCalledWith(
        'sub_owned',
        'immediate'
      )
    );
    expect(onSuccess).toHaveBeenCalled();
    expect(result.current.confirmingSubId).toBeNull();
  });

  it('surfaces a per-sub error and keeps the panel open on failure', async () => {
    vi.mocked(cancelSubscriptionById).mockRejectedValue(
      new Error('Subscription not found')
    );

    const { result } = renderHook(() => usePerSubscriptionCancellation(), {
      wrapper: buildWrapper(),
    });

    act(() => result.current.openConfirm('sub_owned'));
    act(() => result.current.confirmCancel('sub_owned'));

    await waitFor(() => expect(result.current.errorSubId).toBe('sub_owned'));
    expect(result.current.cancelError).toBe(
      "Couldn't cancel this plan. Try again."
    );
  });
});
