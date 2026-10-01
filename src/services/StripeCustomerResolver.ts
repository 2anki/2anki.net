import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import { withStripeRetry } from '../lib/storage/jobs/helpers/withStripeRetry';
import hashToken from '../lib/misc/hashToken';

export interface StripeCustomerStore {
  getStripeCustomerId(id: string | number): Promise<string | null>;
  claimStripeCustomerId(
    id: string | number,
    candidateId: string
  ): Promise<string>;
}

export class StripeCustomerResolver {
  constructor(
    private readonly stripe: Pick<StripeTypes, 'customers'>,
    private readonly store: StripeCustomerStore
  ) {}

  // Links an account to a Stripe customer only when it created that customer
  // itself. Adopting a customer on an unverified email match is deliberately
  // not done: signup does not verify email, so an email match does not prove
  // ownership. Linking an existing customer stays with the email-verified
  // claim flow (ClaimSubscriptionUseCase -> ConfirmSubscriptionClaimUseCase).
  async resolveOrCreate(userId: number, email: string): Promise<string> {
    const stored = await this.store.getStripeCustomerId(userId);
    if (stored != null && stored !== '') {
      return stored;
    }

    const created = await withStripeRetry(
      () =>
        this.stripe.customers.create({
          email,
          metadata: { user_id: String(userId) },
        }),
      'customers.create'
    );
    const winner = await this.store.claimStripeCustomerId(userId, created.id);
    if (winner !== created.id) {
      await this.deleteOrphan(created.id);
      return winner;
    }
    console.info('checkout.customer.created', {
      user_id: userId,
      customer_id_hash: hashToken(winner),
    });
    return winner;
  }

  private async deleteOrphan(customerId: string): Promise<void> {
    try {
      await withStripeRetry(
        () => this.stripe.customers.del(customerId),
        'customers.del'
      );
      console.warn('checkout.customer.orphan_deleted', {
        customer_id_hash: hashToken(customerId),
      });
    } catch (error) {
      console.error('checkout.customer.orphan_delete_failed', {
        customer_id_hash: hashToken(customerId),
        error_name: (error as Error)?.name,
        error_code: (error as { code?: string })?.code,
      });
    }
  }
}

export default StripeCustomerResolver;
