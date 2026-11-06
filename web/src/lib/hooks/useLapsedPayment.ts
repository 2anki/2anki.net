import { useStripeSubscriptions } from './useStripeSubscriptions';

export interface LapsedPaymentLocals {
  subscriber?: boolean;
  patreon?: boolean;
  subscriptionInfo?: { email?: string | null } | null;
}

// Only someone with a Stripe subscription on record can have a failed renewal,
// so nobody without one needs this Stripe read.
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
  const { view, isLoading, failureCount } = useStripeSubscriptions(
    eligible && enabled
  );

  return {
    subscription:
      eligible && view.kind === 'past_due' ? view.subscription : null,
    checking: eligible && enabled && isLoading && failureCount === 0,
  };
}
