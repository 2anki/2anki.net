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

  async resolveOrCreate(userId: number, email: string): Promise<string> {
    const stored = await this.store.getStripeCustomerId(userId);
    if (stored != null && stored !== '') {
      return stored;
    }

    const existing = await this.findByEmail(email);
    if (existing != null) {
      const adopted = await this.store.claimStripeCustomerId(userId, existing);
      console.info('checkout.customer.adopted', {
        user_id: userId,
        customer_id_hash: hashToken(adopted),
      });
      return adopted;
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

  private async findByEmail(email: string): Promise<string | null> {
    const listed = await withStripeRetry(
      () => this.stripe.customers.list({ email, limit: 1 }),
      'customers.list'
    );
    if (listed.data.length > 0) {
      return listed.data[0].id;
    }
    const escaped = email.replace(/(['\\])/g, '\\$1');
    const searched = await withStripeRetry(
      () =>
        this.stripe.customers.search({
          query: `email:'${escaped}'`,
          limit: 1,
        }),
      'customers.search'
    );
    return searched.data[0]?.id ?? null;
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
        error: (error as Error)?.message,
      });
    }
  }
}

export default StripeCustomerResolver;
