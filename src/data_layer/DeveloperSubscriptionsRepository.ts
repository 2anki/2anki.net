import type { Knex } from 'knex';

export interface DeveloperSubscriptionRecord {
  stripeSubscriptionId: string;
  userId: number | null;
  email: string | null;
  stripeProductId: string;
  active: boolean;
  payload: unknown;
}

export interface IDeveloperSubscriptionsRepository {
  upsert(entry: DeveloperSubscriptionRecord): Promise<void>;
  activeProductIdsForUser(userId: number): Promise<string[]>;
  activeProductIdsForEmail(email: string): Promise<string[]>;
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

  // The webhook cannot always resolve an account — a developer can pay under a
  // Stripe email that is not their 2anki email before the two are linked — so
  // the row may carry an email and no user_id. Reading both ways keeps that
  // subscription usable instead of silently dropping the tier.
  // Normalises the INPUT and compares against the raw column, rather than
  // wrapping the column in lower(trim(...)). Postgres cannot serve a predicate
  // over a function call from a plain btree index, so the wrapped form would
  // sequential-scan on every API request that reaches this fallback. The only
  // writer stores the value through normalizeEmail, so the column is already
  // lowercased and trimmed.
  async activeProductIdsForEmail(email: string): Promise<string[]> {
    const normalized = email.trim().toLowerCase();
    if (normalized.length === 0) return [];
    const rows = await this.knex(this.table)
      .where({ email: normalized, active: true })
      .select('stripe_product_id');
    return toProductIds(rows);
  }
}

function toProductIds(rows: { stripe_product_id?: string | null }[]): string[] {
  return rows
    .map((row) => row.stripe_product_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

export default DeveloperSubscriptionsRepository;
