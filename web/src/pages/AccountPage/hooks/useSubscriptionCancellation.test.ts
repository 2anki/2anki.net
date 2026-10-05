// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';

vi.mock('../../../lib/backend/cancelSubscription', () => ({
  cancelSubscription: vi.fn(),
  submitCancellationFeedback: vi.fn(),
}));

import {
  cancelSubscription,
  submitCancellationFeedback,
} from '../../../lib/backend/cancelSubscription';
import { useSubscriptionCancellation } from './useSubscriptionCancellation';

function buildWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useSubscriptionCancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fires the cancel call as soon as the button is clicked, with no survey gate', async () => {
    vi.mocked(cancelSubscription).mockResolvedValue({ message: 'ok' });

    const { result } = renderHook(() => useSubscriptionCancellation(), {
      wrapper: buildWrapper(),
    });

    act(() => {
      result.current.cancelUserSubscription('period_end', 1_800_000_000);
    });

    await waitFor(() => {
      expect(cancelSubscription).toHaveBeenCalledWith('period_end', undefined);
    });
  });

  it('forwards the cancellation reason to the backend call', async () => {
    vi.mocked(cancelSubscription).mockResolvedValue({ message: 'ok' });

    const { result } = renderHook(() => useSubscriptionCancellation(), {
      wrapper: buildWrapper(),
    });

    act(() => {
      result.current.cancelUserSubscription(
        'period_end',
        1_800_000_000,
        "I don't use it enough"
      );
    });

    await waitFor(() => {
      expect(cancelSubscription).toHaveBeenCalledWith(
        'period_end',
        "I don't use it enough"
      );
    });
  });

  it('shows the date-specific confirmation and reveals the optional follow-up on success', async () => {
    vi.mocked(cancelSubscription).mockResolvedValue({ message: 'ok' });

    const { result } = renderHook(() => useSubscriptionCancellation(), {
      wrapper: buildWrapper(),
    });

    act(() => {
      result.current.cancelUserSubscription('period_end', 1_800_000_000);
    });

    await waitFor(() => {
      expect(result.current.showFollowUp).toBe(true);
    });
    expect(result.current.cancelSuccess).toMatch(
      /^Cancelled\. You keep access until /
    );
    expect(result.current.cancelError).toBe('');
  });

  it('surfaces the server message and keeps the follow-up hidden on failure', async () => {
    vi.mocked(cancelSubscription).mockRejectedValue(
      new Error('No active subscription found for this account.')
    );

    const { result } = renderHook(() => useSubscriptionCancellation(), {
      wrapper: buildWrapper(),
    });

    act(() => {
      result.current.cancelUserSubscription('period_end', 1_800_000_000);
    });

    await waitFor(() => {
      expect(result.current.cancelError).toBe(
        'No active subscription found for this account.'
      );
    });
    expect(result.current.showFollowUp).toBe(false);
    expect(result.current.cancelSuccess).toBe('');
  });

  it('posts feedback through the separate endpoint and hides the follow-up', async () => {
    vi.mocked(submitCancellationFeedback).mockResolvedValue();

    const { result } = renderHook(() => useSubscriptionCancellation(), {
      wrapper: buildWrapper(),
    });

    act(() => {
      result.current.submitFeedback('Too expensive', 'details');
    });

    await waitFor(() => {
      expect(submitCancellationFeedback).toHaveBeenCalledWith(
        'Too expensive',
        'details'
      );
    });
    await waitFor(() => {
      expect(result.current.showFollowUp).toBe(false);
    });
  });

  it('dismisses the follow-up without submitting feedback', () => {
    const { result } = renderHook(() => useSubscriptionCancellation(), {
      wrapper: buildWrapper(),
    });

    act(() => {
      result.current.dismissFollowUp();
    });

    expect(result.current.showFollowUp).toBe(false);
    expect(submitCancellationFeedback).not.toHaveBeenCalled();
  });
});
