import { Knex } from 'knex';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import { DeveloperSubscriptionsRepository } from '../../../../data_layer/DeveloperSubscriptionsRepository';
import { isPaused } from '../../../subscriptions/isPaused';

interface ActiveSubscriptionRow {
  id: number;
  payload: unknown;
}

// Mirrors ACCESS_GRANTING_STATUSES in src/lib/integrations/stripe.ts, which is
// module-private there. Keep the two in step: a status outside this set means
// Stripe has stopped granting access and the local row must follow.
const ACCESS_GRANTING_STATUSES = new Set<StripeTypes.Subscription['status']>([
  'active',
  'past_due',
  'unpaid',
]);

function parseSubscriptionId(payload: unknown): string | null {
  if (payload == null) return null;
  if (typeof payload === 'object') {
    const id = (payload as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return typeof parsed?.id === 'string' ? parsed.id : null;
    } catch {
      return null;
    }
  }
  return null;
}

function stripeReportsInactive(
  subscription: StripeTypes.Subscription
): boolean {
  if (subscription.status !== 'active') return true;

  if (subscription.cancel_at_period_end && subscription.cancel_at) {
    const periodEndMs = subscription.cancel_at * 1000;
    return Date.now() >= periodEndMs;
  }
  return false;
}

async function deactivateRow(
  db: Knex,
  row: ActiveSubscriptionRow,
  subscription?: StripeTypes.Subscription
): Promise<void> {
  const update: { active: boolean; payload?: string } = { active: false };
  if (subscription) {
    update.payload = JSON.stringify(subscription);
  }
  await db('subscriptions').where({ id: row.id }).update(update);
  console.info(`[stripe-sync] Flipped subscription row ${row.id} to inactive`);
}

async function reconcileSubscriptionsTable(
  db: Knex,
  stripe: Pick<StripeTypes, 'subscriptions'>
): Promise<void> {
  const rows: ActiveSubscriptionRow[] = await db('subscriptions')
    .select('id', 'payload')
    .where({ active: true });

  console.info(`[stripe-sync] Reconciling ${rows.length} active DB row(s)`);

  for (const row of rows) {
    const subscriptionId = parseSubscriptionId(row.payload);
    if (!subscriptionId) {
      console.warn(
        `[stripe-sync] Row ${row.id} has no parseable subscription id; skipping`
      );
      continue;
    }

    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (stripeReportsInactive(subscription)) {
        await deactivateRow(db, row, subscription);
      }
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 404) {
        await deactivateRow(db, row);
        continue;
      }
      console.error(`[stripe-sync] Failed to reconcile row ${row.id}:`, error);
    }
  }
}

function developerSubscriptionRemainsActive(
  subscription: StripeTypes.Subscription
): boolean {
  if (!ACCESS_GRANTING_STATUSES.has(subscription.status)) return false;
  if (isPaused(subscription)) return false;

  if (subscription.cancel_at_period_end && subscription.cancel_at) {
    const periodEndMs = subscription.cancel_at * 1000;
    return Date.now() < periodEndMs;
  }
  return true;
}

export async function reconcileDeveloperSubscriptions(
  db: Knex,
  stripe: Pick<StripeTypes, 'subscriptions'>
): Promise<void> {
  const repository = new DeveloperSubscriptionsRepository(db);
  const rows = await repository.listActive();

  console.info(
    `[stripe-sync] Reconciling ${rows.length} active developer subscription row(s)`
  );

  for (const row of rows) {
    try {
      const subscription = await stripe.subscriptions.retrieve(
        row.stripe_subscription_id
      );
      if (!developerSubscriptionRemainsActive(subscription)) {
        await repository.deactivateBySubscriptionId(row.stripe_subscription_id);
        console.info(
          `[stripe-sync] Flipped developer subscription row ${row.id} to inactive`
        );
      }
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 404) {
        await repository.deactivateBySubscriptionId(row.stripe_subscription_id);
        console.info(
          `[stripe-sync] Flipped developer subscription row ${row.id} to inactive (Stripe 404)`
        );
        continue;
      }
      console.error(
        `[stripe-sync] Failed to reconcile developer subscription row ${row.id}:`,
        error
      );
    }
  }
}

export async function reconcileActiveSubscriptions(
  db: Knex,
  stripe: Pick<StripeTypes, 'subscriptions'>
): Promise<void> {
  await reconcileSubscriptionsTable(db, stripe);
  await reconcileDeveloperSubscriptions(db, stripe);
}
