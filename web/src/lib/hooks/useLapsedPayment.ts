import {
  findLapsedSubscription,
  useStripeSubscriptions,
} from './useStripeSubscriptions';

export interface LapsedPaymentLocals {
  subscriber?: boolean;
  patreon?: boolean;
  subscriptionInfo?: { email?: string | null } | null;
}

// Only someone with a Stripe subscription on record can have a failed renewal,
// so nobody without one costs a Stripe read. The lapsed plan is looked for
// beside any active row: a developer tier stays active while the base plan
// lapses, and the base plan is what ended this person's access.
export function mayHaveLapsedPayment(
  locals: LapsedPaymentLocals | undefined | null
): boolean {
  if (locals == null) return false;
  if (locals.subscriber === true || locals.patreon === true) return false;
  return locals.subscriptionInfo?.email != null;
}

export function useLapsedPayment(
  locals: LapsedPaymentLocals | undefined | null,
  enabled = true
) {
  const eligible = mayHaveLapsedPayment(locals);
  const { subscriptions, isLoading, failureCount } = useStripeSubscriptions(
    eligible && enabled
  );

  return {
    subscription: eligible ? findLapsedSubscription(subscriptions) : null,
    checking: eligible && enabled && isLoading && failureCount === 0,
  };
}
