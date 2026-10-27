import type { UserPass } from '../../data_layer/UserPassRepository';

export function isAppleSubscriptionPass(
  pass: Pick<UserPass, 'kind' | 'stripe_payment_intent_id'>
): boolean {
  return (
    pass.kind === 'unlimited' &&
    pass.stripe_payment_intent_id.startsWith('apple:')
  );
}
