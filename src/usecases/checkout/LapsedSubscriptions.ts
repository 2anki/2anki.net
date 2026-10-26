import type StripeTypes from 'stripe';
import { isStaleCustomerError } from './createCheckoutSession';

// Stripe keeps these open on the customer while no payment for the current
// period has gone through. An open one locks the customer's currency, so a new
// subscription in another currency is refused, and its open invoice can still
// be collected later, so a new subscription in the same currency would charge
// the person twice.
const LAPSED_STATUSES: ReadonlySet<string> = new Set([
  'past_due',
  'unpaid',
  'incomplete',
]);

export interface LapsedPlan {
  subscriptionId: string;
  amount: number | null;
  currency: string;
  interval: 'month' | 'year' | null;
  openInvoiceId: string | null;
  payUrl: string | null;
}

export interface LapsedSubscriptionGateway {
  find(customerId: string): Promise<LapsedPlan[]>;
  close(plans: LapsedPlan[]): Promise<void>;
}

export class LapsedSubscriptionError extends Error {
  constructor(readonly plan: LapsedPlan) {
    super('lapsed_subscription');
    this.name = 'LapsedSubscriptionError';
  }
}

const toInterval = (interval: string | undefined): LapsedPlan['interval'] =>
  interval === 'month' || interval === 'year' ? interval : null;

const toLapsedPlan = (subscription: StripeTypes.Subscription): LapsedPlan => {
  const price = subscription.items.data[0]?.price;
  const invoice =
    typeof subscription.latest_invoice === 'object'
      ? subscription.latest_invoice
      : null;
  const open = invoice?.status === 'open' ? invoice : null;
  return {
    subscriptionId: subscription.id,
    amount: price?.unit_amount ?? null,
    currency: subscription.currency,
    interval: toInterval(price?.recurring?.interval),
    openInvoiceId: open?.id ?? null,
    payUrl: open?.hosted_invoice_url ?? null,
  };
};

export class StripeLapsedSubscriptions implements LapsedSubscriptionGateway {
  constructor(
    private readonly stripe: Pick<StripeTypes, 'subscriptions' | 'invoices'>
  ) {}

  async find(customerId: string): Promise<LapsedPlan[]> {
    try {
      const list = await this.stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 20,
        expand: ['data.latest_invoice'],
      });
      return list.data
        .filter((subscription) => LAPSED_STATUSES.has(subscription.status))
        .map(toLapsedPlan);
    } catch (error) {
      // A stale customer has no subscriptions to settle; checkout's own
      // stale-customer recovery takes it from here.
      if (isStaleCustomerError(error)) {
        return [];
      }
      throw error;
    }
  }

  // Cancel before voiding, so no status change on a still-open subscription
  // reaches the webhook and grants access for a moment.
  async close(plans: LapsedPlan[]): Promise<void> {
    for (const plan of plans) {
      await this.stripe.subscriptions.cancel(plan.subscriptionId);
      if (plan.openInvoiceId == null) {
        continue;
      }
      try {
        await this.stripe.invoices.voidInvoice(plan.openInvoiceId);
      } catch (error) {
        console.warn('unlimited.checkout.lapsed_invoice_void_failed', {
          error_code: (error as { code?: string }).code,
        });
      }
    }
  }
}
