import { getStripe } from '../lib/integrations/stripe';
import { withStripeRetry } from '../lib/storage/jobs/helpers/withStripeRetry';

export interface StripeCustomerEmails {
  emailOf(customerId: string): Promise<string | null>;
  setEmail(customerId: string, email: string): Promise<void>;
}

export class StripeCustomerEmailService implements StripeCustomerEmails {
  async emailOf(customerId: string): Promise<string | null> {
    const customer = await withStripeRetry(
      () => getStripe().customers.retrieve(customerId),
      'stripeCustomerEmail.retrieve'
    );
    if ('deleted' in customer && customer.deleted === true) {
      return null;
    }
    return 'email' in customer ? (customer.email ?? null) : null;
  }

  async setEmail(customerId: string, email: string): Promise<void> {
    await withStripeRetry(
      () => getStripe().customers.update(customerId, { email }),
      'stripeCustomerEmail.update'
    );
  }
}
