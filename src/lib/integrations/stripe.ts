import Stripe from 'stripe';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import { Knex } from 'knex';
import { DeveloperSubscriptionsRepository } from '../../data_layer/DeveloperSubscriptionsRepository';
import { isPaused } from '../subscriptions/isPaused';

let stripeInstance: InstanceType<typeof Stripe> | null = null;

export const getStripe = () => {
  if (stripeInstance == null) {
    stripeInstance = new Stripe(process.env.STRIPE_KEY!);
  }
  return stripeInstance;
};

export const getCustomerId = (
  customer: string | StripeTypes.Customer | StripeTypes.DeletedCustomer | null
) => {
  if (typeof customer === 'string') {
    return customer;
  }
  return customer?.id;
};

export const extractProductId = (
  subscription: StripeTypes.Subscription
): string | null => {
  const product = subscription.items?.data?.[0]?.price?.product;
  if (product == null) {
    return null;
  }
  if (typeof product === 'string') {
    return product;
  }
  return product.id;
};

export interface ResolvedAccount {
  id: number;
  email: string | null;
}

export type ProvisionStatus = 'linked' | 'unlinked';

export interface ProvisionResult {
  status: ProvisionStatus;
  resolvedUserId: number | null;
}

export const normalizeEmail = (
  email: string | null | undefined
): string | null => {
  if (email == null) {
    return null;
  }
  const normalized = email.toLowerCase().trim();
  return normalized.length > 0 ? normalized : null;
};

export const resolveAccountForSubscription = async (
  db: Knex,
  subscription: StripeTypes.Subscription,
  customerId: string | null,
  stripeEmail: string | null
): Promise<ResolvedAccount | null> => {
  const metaUserId = subscription.metadata?.user_id;
  if (metaUserId != null && metaUserId.trim().length > 0) {
    const parsed = Number.parseInt(metaUserId, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      const byId = await db('users')
        .where({ id: parsed })
        .select('id', 'email')
        .first();
      if (byId != null) {
        return { id: byId.id, email: byId.email ?? null };
      }
    }
  }

  if (customerId != null) {
    const byCustomer = await db('users')
      .where({ stripe_customer_id: customerId })
      .select('id', 'email')
      .first();
    if (byCustomer != null) {
      return { id: byCustomer.id, email: byCustomer.email ?? null };
    }
  }

  if (stripeEmail != null) {
    const byEmail = await db('users')
      .whereRaw('lower(trim(email)) = ?', [stripeEmail])
      .select('id', 'email')
      .first();
    if (byEmail != null) {
      return { id: byEmail.id, email: byEmail.email ?? null };
    }

    const ownSubscriptionRow = await db('subscriptions')
      .whereRaw('lower(trim(email)) = ?', [stripeEmail])
      .whereNotNull('linked_email')
      .select('linked_email')
      .first();
    const linkedEmail = normalizeEmail(ownSubscriptionRow?.linked_email);
    if (linkedEmail != null) {
      const byLinkedEmail = await db('users')
        .whereRaw('lower(trim(email)) = ?', [linkedEmail])
        .select('id', 'email')
        .first();
      if (byLinkedEmail != null) {
        return { id: byLinkedEmail.id, email: byLinkedEmail.email ?? null };
      }
    }
  }

  return null;
};

// developer_tiers is the source of truth for which Stripe products are API
// tiers; hardcoding the product ids here would drift the moment a tier is added
// through the ops page.
export const isDeveloperTierProduct = async (
  db: Knex,
  productId: string
): Promise<boolean> => {
  const row = await db('developer_tiers')
    .where({ stripe_product_id: productId })
    .select('id')
    .first();
  return row != null;
};

const ACCESS_GRANTING_STATUSES = new Set<StripeTypes.Subscription['status']>([
  'active',
  'past_due',
  'unpaid',
]);

export const updateStoreSubscription = async (
  db: Knex,
  customer: StripeTypes.Customer,
  subscription: StripeTypes.Subscription
): Promise<ProvisionResult> => {
  const stripeEmail = normalizeEmail(customer.email);
  const grantsAccess = ACCESS_GRANTING_STATUSES.has(subscription.status);
  const isCancelScheduled = subscription.cancel_at_period_end === true;

  let shouldRemainActive = grantsAccess;
  if (grantsAccess && isCancelScheduled) {
    const periodEndDate = new Date((subscription.cancel_at ?? 0) * 1000);
    const currentDate = new Date();
    shouldRemainActive = currentDate < periodEndDate;
  }
  if (isPaused(subscription)) {
    shouldRemainActive = false;
  }

  const stripeProductId = extractProductId(subscription);

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : (subscription.customer?.id ?? null);

  const account = await resolveAccountForSubscription(
    db,
    subscription,
    customerId,
    stripeEmail
  );

  const accountEmail = normalizeEmail(account?.email);
  const linkedEmail =
    accountEmail != null && accountEmail !== stripeEmail ? accountEmail : null;

  // A developer tier is a SECOND concurrent subscription — a base-plan
  // subscriber can also hold Starter or Growth. The subscriptions table upserts
  // on email, so writing both there collapses them into one row whose active
  // and stripe_product_id reflect whichever webhook fired last. Routed to its
  // own table instead, where the key is the Stripe subscription id and two
  // concurrent subscriptions are representable.
  if (
    stripeProductId != null &&
    (await isDeveloperTierProduct(db, stripeProductId))
  ) {
    await new DeveloperSubscriptionsRepository(db).upsert({
      stripeSubscriptionId: subscription.id,
      userId: account?.id ?? null,
      email: accountEmail ?? stripeEmail,
      stripeProductId,
      active: shouldRemainActive,
      payload: subscription,
    });
    if (account != null && customerId != null) {
      await db('users')
        .where({ id: account.id })
        .update({ stripe_customer_id: customerId });
    }
    return account != null
      ? { status: 'linked', resolvedUserId: account.id }
      : { status: 'unlinked', resolvedUserId: null };
  }

  const insertRow: Record<string, unknown> = {
    email: stripeEmail,
    active: shouldRemainActive,
    payload: JSON.stringify(subscription),
    stripe_product_id: stripeProductId,
  };
  if (linkedEmail != null) {
    insertRow.linked_email = linkedEmail;
  }

  const mergeColumns: Record<string, unknown> = {
    active: shouldRemainActive,
    payload: JSON.stringify(subscription),
    stripe_product_id: stripeProductId,
    updated_at: new Date(),
  };
  if (linkedEmail != null) {
    mergeColumns.linked_email = linkedEmail;
  }

  await db('subscriptions')
    .insert(insertRow)
    .onConflict('email')
    .merge(mergeColumns);

  if (account != null && customerId != null) {
    await db('users')
      .where({ id: account.id })
      .update({ stripe_customer_id: customerId });
  }

  if (account != null) {
    return { status: 'linked', resolvedUserId: account.id };
  }
  return { status: 'unlinked', resolvedUserId: null };
};
