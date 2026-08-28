import { useQuery } from '@tanstack/react-query';
import {
  getSubscriptionStatus,
  StripeSubscriptionSummary,
} from '../backend/getSubscriptionStatus';

export type SubscriptionViewState =
  | { kind: 'none' }
  | { kind: 'active'; subscription: StripeSubscriptionSummary }
  | { kind: 'scheduled'; subscription: StripeSubscriptionSummary }
  | { kind: 'paused'; subscription: StripeSubscriptionSummary }
  | { kind: 'past_due'; subscription: StripeSubscriptionSummary }
  | { kind: 'cancelled'; subscription: StripeSubscriptionSummary };

export interface StripeSubscriptionsState {
  subscriptions: StripeSubscriptionSummary[];
  activeSubscriptions: StripeSubscriptionSummary[];
  view: SubscriptionViewState;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

const RECENT_CANCEL_WINDOW_SECONDS = 30 * 24 * 60 * 60;

const isRecentlyCancelled = (
  sub: StripeSubscriptionSummary,
  nowMs: number
): boolean => {
  if (sub.canceled_at == null) return false;
  const secondsSinceCancel = nowMs / 1000 - sub.canceled_at;
  return secondsSinceCancel <= RECENT_CANCEL_WINDOW_SECONDS;
};

export function deriveView(
  subscriptions: StripeSubscriptionSummary[],
  nowMs: number = Date.now()
): SubscriptionViewState {
  const active = subscriptions.find((sub) => sub.status === 'active');
  if (active) {
    if (active.paused_until != null) {
      return { kind: 'paused', subscription: active };
    }
    return active.cancel_at_period_end
      ? { kind: 'scheduled', subscription: active }
      : { kind: 'active', subscription: active };
  }

  const pastDue = subscriptions.find(
    (sub) => sub.status === 'past_due' || sub.status === 'unpaid'
  );
  if (pastDue) {
    return { kind: 'past_due', subscription: pastDue };
  }

  const cancelled = subscriptions.find((sub) => sub.status === 'canceled');
  if (cancelled && isRecentlyCancelled(cancelled, nowMs)) {
    return { kind: 'cancelled', subscription: cancelled };
  }

  return { kind: 'none' };
}

export function useStripeSubscriptions(
  enabled: boolean
): StripeSubscriptionsState {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['stripeSubscriptions'],
    queryFn: getSubscriptionStatus,
    enabled,
    staleTime: 15_000,
  });

  const subscriptions = data?.subscriptions ?? [];
  const activeSubscriptions = subscriptions.filter(
    (sub) => sub.status === 'active'
  );

  return {
    subscriptions,
    activeSubscriptions,
    view: deriveView(subscriptions),
    isLoading,
    isError,
    refetch,
  };
}
