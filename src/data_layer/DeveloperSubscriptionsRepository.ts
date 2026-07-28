import type { Knex } from 'knex';

export interface DeveloperSubscriptionRecord {
  stripeSubscriptionId: string;
  userId: number | null;
  email: string | null;
  stripeProductId: string;
  active: boolean;
  payload: unknown;
}

export interface ActiveDeveloperSubscriptionRow {
  id: number;
  stripe_subscription_id: string;
}

export interface IDeveloperSubscriptionsRepository {
  upsert(entry: DeveloperSubscriptionRecord): Promise<void>;
  activeProductIdsForUser(userId: number): Promise<string[]>;
  listActive(): Promise<ActiveDeveloperSubscriptionRow[]>;
  deactivateBySubscriptionId(stripeSubscriptionId: string): Promise<number>;
}

export class DeveloperSubscriptionsRepository implements IDeveloperSubscriptionsRepository {
  private readonly table = 'subscriptions_developer';

  constructor(private readonly knex: Knex) {}

  // Keyed on the Stripe subscription id, so a customer holding both Starter and
  // Growth gets two rows instead of one overwriting the other. That is the whole
  // point of the table — the subscriptions table upserts on email and cannot
  // represent two concurrent subscriptions at all.
  async upsert(entry: DeveloperSubscriptionRecord): Promise<void> {
    await this.knex(this.table)
      .insert({
        stripe_subscription_id: entry.stripeSubscriptionId,
        user_id: entry.userId,
        email: entry.email,
        stripe_product_id: entry.stripeProductId,
        active: entry.active,
        payload: JSON.stringify(entry.payload),
        updated_at: this.knex.fn.now(),
      })
      .onConflict('stripe_subscription_id')
      .merge({
        user_id: entry.userId,
        email: entry.email,
        stripe_product_id: entry.stripeProductId,
        active: entry.active,
        payload: JSON.stringify(entry.payload),
        updated_at: this.knex.fn.now(),
      });
  }

  async activeProductIdsForUser(userId: number): Promise<string[]> {
    const rows = await this.knex(this.table)
      .where({ user_id: userId, active: true })
      .select('stripe_product_id');
    return toProductIds(rows);
  }

  // The reconcile sweep re-checks every active row against Stripe. It keys on
  // the dedicated stripe_subscription_id column, so no payload parsing is
  // needed — unlike the subscriptions table, which digs the id out of payload.
  async listActive(): Promise<ActiveDeveloperSubscriptionRow[]> {
    return this.knex(this.table)
      .where({ active: true })
      .select('id', 'stripe_subscription_id');
  }

  // The webhook cannot always resolve an account — a developer can pay under a
  // Stripe email that is not their 2anki email before the two are linked — so
  // the row may carry an email and no user_id. Reading both ways keeps that
  // subscription usable instead of silently dropping the tier.
  // Deactivation is keyed on the Stripe subscription id and needs no account:
  // the cancellation webhook cannot always resolve one, and a row that outlives
  // its cancellation keeps granting a paid tier forever — nothing sweeps this
  // table, and STRIPE_SYNC_ON_STARTUP is off in production.
  async deactivateBySubscriptionId(
    stripeSubscriptionId: string
  ): Promise<number> {
    return this.knex(this.table)
      .where({ stripe_subscription_id: stripeSubscriptionId })
      .update({ active: false, updated_at: this.knex.fn.now() });
  }
}

function toProductIds(rows: { stripe_product_id?: string | null }[]): string[] {
  return rows
    .map((row) => row.stripe_product_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export default DeveloperSubscriptionsRepository;
