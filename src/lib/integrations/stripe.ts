import Stripe from 'stripe';
import type StripeTypes from 'stripe';
import type { Knex } from 'knex';
import { DeveloperSubscriptionsRepository } from '../../data_layer/DeveloperSubscriptionsRepository';
import { isPaused } from '../subscriptions/isPaused';
import { emailHash } from '../emailHash';

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

// Only a paid-up subscription grants access. A failed renewal (past_due or
// unpaid) ends access at once; if a Stripe retry or the person's own payment
// succeeds, the subscription returns to active and access comes back with the
// next webhook. Decided 2026-10-26, reversing the dunning grace window from
// #3596: without it, access ended whenever the sync next ran, anywhere from
// hours to two weeks after the failure.
const ACCESS_GRANTING_STATUSES = new Set<StripeTypes.Subscription['status']>([
  'active',
]);

// subscriptions.linked_email is unique: when another subscription row already
// links that account (the payer changed their Stripe email, say), writing it
// again would fail the whole provisioning. The existing link stays.
const linkableEmail = async (
  db: Knex,
  candidate: string | null,
  stripeEmail: string | null
): Promise<string | null> => {
  if (candidate == null) {
    return null;
  }
  const holder = await db('subscriptions')
    .where({ linked_email: candidate })
    .modify((query) => {
      if (stripeEmail != null) {
        query.whereNot({ email: stripeEmail });
      }
    })
    .select('id')
    .first();
  if (holder != null) {
    console.info('[stripe] account already linked to another subscription row');
    return null;
  }
  return candidate;
};

// Records the Stripe customer id on the resolved account, unless another
// account already holds it: someone paid for a subscription linked to a
// different account, and users.stripe_customer_id is unique, so the write
// would fail the whole provisioning. The holder keeps it (#5025).
const stampCustomerId = async (
  db: Knex,
  account: ResolvedAccount | null,
  customerId: string | null
): Promise<void> => {
  if (account == null || customerId == null) {
    return;
  }
  const holder = await db('users')
    .where({ stripe_customer_id: customerId })
    .whereNot({ id: account.id })
    .select('id')
    .first();
  if (holder != null) {
    console.info(
      `[stripe] customer id already linked to another account customer=${emailHash(customerId).slice(-8)}`
    );
    return;
  }
  await db('users')
    .where({ id: account.id })
    .update({ stripe_customer_id: customerId });
};

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
  const linkedEmail = await linkableEmail(
    db,
    accountEmail != null && accountEmail !== stripeEmail ? accountEmail : null,
    stripeEmail
  );

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
    await stampCustomerId(db, account, customerId);
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

  await stampCustomerId(db, account, customerId);

  if (account != null) {
    return { status: 'linked', resolvedUserId: account.id };
  }
  return { status: 'unlinked', resolvedUserId: null };
};
