import type StripeTypes from 'stripe';
import type { Knex } from 'knex';

import { updateStoreSubscription } from '../../lib/integrations/stripe';

type StripeClient = Pick<
  StripeTypes,
  'checkout' | 'subscriptions' | 'customers'
>;

export class PersistStripeSessionUseCase {
  constructor(
    private readonly stripe: StripeClient,
    private readonly database: Knex
  ) {}

  async execute(sessionId: string): Promise<boolean> {
    const session = await this.stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') {
      return false;
    }
    if (session.subscription) {
      const subscriptionId =
        typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription.id;
      const subscription =
        await this.stripe.subscriptions.retrieve(subscriptionId);
      const customerId =
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;
      const customer = (await this.stripe.customers.retrieve(
        customerId
      )) as StripeTypes.Customer;
      await updateStoreSubscription(this.database, customer, subscription);
    }
    return true;
  }
}

export default PersistStripeSessionUseCase;
