import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { getSubscriptionStatus } from '../backend/getSubscriptionStatus';
import { mayHaveLapsedPayment, useLapsedPayment } from './useLapsedPayment';

vi.mock('../backend/getSubscriptionStatus', () => ({
  getSubscriptionStatus: vi.fn(),
}));

const onRecord = { subscriptionInfo: { email: 'payer@example.com' } };

describe('mayHaveLapsedPayment', () => {
  it('is true for a non-paying account with a subscription on record', () => {
    expect(
      mayHaveLapsedPayment({ subscriber: false, patreon: false, ...onRecord })
    ).toBe(true);
  });

  it.each([
    ['a signed-out visitor', undefined],
    ['an empty read', null],
    ['someone who has never paid', { subscriber: false, patreon: false }],
    ['an empty subscription record', { subscriptionInfo: {} }],
    ['a subscriber', { subscriber: true, ...onRecord }],
    [
      'a pass or Apple holder with a lapsed plan',
      { subscriber: true, passKind: '7d', ...onRecord },
    ],
    ['a lifetime holder', { patreon: true, ...onRecord }],
  ])('is false for %s', (_who, locals) => {
    expect(mayHaveLapsedPayment(locals)).toBe(false);
  });
});

describe('useLapsedPayment', () => {
  it.each([
    ['a pass holder', { subscriber: true, passKind: '7d', ...onRecord }],
    ['a lifetime holder', { patreon: true, ...onRecord }],
  ])('ignores a past-due read already in the cache for %s', (_who, locals) => {
    const client = new QueryClient();
    client.setQueryData(['stripeSubscriptions'], {
      subscriptions: [{ id: 'sub_lapsed', status: 'past_due' }],
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useLapsedPayment(locals), {
      wrapper,
    });

    expect(result.current).toEqual({ subscription: null, checking: false });
  });

  it('stops holding the plan back after the first failed read, while retries run', async () => {
    vi.mocked(getSubscriptionStatus).mockRejectedValue(
      new Error('stripe down')
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: 3, retryDelay: 60_000 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);

    const { result } = renderHook(() => useLapsedPayment(onRecord), {
      wrapper,
    });

    expect(result.current.checking).toBe(true);
    await waitFor(() => expect(result.current.checking).toBe(false));
    expect(client.isFetching()).toBe(1);
    expect(result.current.subscription).toBeNull();
    client.clear();
  });
});
