import type { StripeCustomerEmails } from '../../services/StripeCustomerEmailService';
import { isAppleRelayAddress } from '../../lib/email/isAppleRelayAddress';

export interface BillingEmailRepository {
  subscriptionAddressTaken(email: string): Promise<boolean>;
  payerBilling(
    userId: number,
    payerEmail: string
  ): Promise<{ isPayer: boolean; stripeCustomerIds: string[] }>;
}

export type BillingEmailRefusal =
  | 'subscription_address_taken'
  | 'payer_relay_address'
  | 'stripe_update_failed';

export type BillingEmailMove =
  | { ok: true; revert: () => Promise<void> }
  | { ok: false; reason: BillingEmailRefusal };

export interface BillingEmailChange {
  userId: number;
  currentEmail: string;
  newEmail: string;
}

function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

interface MovedCustomer {
  customerId: string;
  previousEmail: string;
}

async function restore(
  stripe: StripeCustomerEmails,
  moved: MovedCustomer[],
  userId: number
): Promise<void> {
  for (const { customerId, previousEmail } of moved) {
    try {
      await stripe.setEmail(customerId, previousEmail);
    } catch (error) {
      console.error(
        '[email-change] could not restore a Stripe customer email',
        {
          userId,
          error: error instanceof Error ? error.name : 'unknown',
        }
      );
    }
  }
}

// Runs before the account's email changes, so the database never moves ahead
// of Stripe. A payer's Stripe customers move to the new address first, because
// the subscription webhooks upsert on the Stripe customer's email; only a
// customer still on the old address is touched, so a customer id stamped from
// someone else's subscription is left alone. A failed update puts back the
// ones already moved and refuses the change. The caller runs revert() if its
// own database step then fails.
export async function moveBillingEmail(
  repository: BillingEmailRepository,
  stripe: StripeCustomerEmails,
  change: BillingEmailChange
): Promise<BillingEmailMove> {
  const { userId, currentEmail, newEmail } = change;
  if (await repository.subscriptionAddressTaken(newEmail)) {
    return { ok: false, reason: 'subscription_address_taken' };
  }
  const billing = await repository.payerBilling(userId, currentEmail);
  if (!billing.isPayer) {
    return { ok: true, revert: async () => undefined };
  }
  if (isAppleRelayAddress(newEmail)) {
    return { ok: false, reason: 'payer_relay_address' };
  }
  const moved: MovedCustomer[] = [];
  try {
    for (const customerId of billing.stripeCustomerIds) {
      const previousEmail = await stripe.emailOf(customerId);
      if (previousEmail != null && sameAddress(previousEmail, currentEmail)) {
        await stripe.setEmail(customerId, newEmail);
        moved.push({ customerId, previousEmail });
      }
    }
  } catch (error) {
    console.warn('[email-change] Stripe customer email update failed', {
      userId,
      moved: moved.length,
      error: error instanceof Error ? error.name : 'unknown',
    });
    await restore(stripe, moved, userId);
    return { ok: false, reason: 'stripe_update_failed' };
  }
  console.info('[email-change] Stripe customer email moved', {
    userId,
    customers: moved.length,
  });
  return {
    ok: true,
    revert: () => restore(stripe, moved, userId),
  };
}
