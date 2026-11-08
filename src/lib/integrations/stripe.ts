import Stripe from 'stripe';
import type StripeTypes from 'stripe';
import type { Knex } from 'knex';
import { DeveloperSubscriptionsRepository } from '../../data_layer/DeveloperSubscriptionsRepository';
import { isPaused } from '../subscriptions/isPaused';
import { emailHash } from '../emailHash';
import {
  accountHoldsAddress,
  planSubscriptionId,
} from '../subscriptions/payerAddressProof';

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
    if (byEmail != null && (await accountHoldsAddress(db, stripeEmail))) {
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

const planGrantsAccess = (subscription: StripeTypes.Subscription): boolean => {
  if (
    !ACCESS_GRANTING_STATUSES.has(subscription.status) ||
    isPaused(subscription)
  ) {
    return false;
  }
  if (subscription.cancel_at_period_end !== true) {
    return true;
  }
  return new Date() < new Date((subscription.cancel_at ?? 0) * 1000);
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

// A plan that ended with no account to resolve still has to read as ended, or
// the row keeps blocking checkout and grants access once an address is proven.
// Keyed on the id, so it cannot touch a newer plan that took over the row.
export const deactivateSubscriptionRow = (
  db: Knex,
  subscription: StripeTypes.Subscription
) =>
  db('subscriptions')
    .whereRaw("payload->>'id' = ?", [subscription.id])
    .update({
      active: false,
      payload: JSON.stringify(subscription),
      updated_at: new Date(),
    });

// The row is only the last event delivered, and events can arrive late, so
// Stripe says whether the held plan still runs. Any other failure throws: the
// webhook answers 5xx, Stripe retries, and the row stays as it was.
const heldPlanStillRuns = async (subscriptionId: string): Promise<boolean> => {
  try {
    return planGrantsAccess(
      await getStripe().subscriptions.retrieve(subscriptionId)
    );
  } catch (error) {
    if ((error as { code?: string }).code === 'resource_missing') {
      return false;
    }
    throw error;
  }
};

// Stripe neither orders nor dedupes webhook events, so the subscription inside
// one can be older than the row: an "active" copy redelivered after the plan
// ended would turn access back on, and nothing on prod repairs the row later.
export const latestSubscriptionState = async (
  subscription: StripeTypes.Subscription
): Promise<StripeTypes.Subscription> => {
  try {
    return await getStripe().subscriptions.retrieve(subscription.id);
  } catch (error) {
    if ((error as { code?: string }).code === 'resource_missing') {
      return { ...subscription, status: 'canceled' };
    }
    throw error;
  }
};

const wouldReplaceAutoSync = (
  heldProductId: string | null | undefined,
  incomingProductId: string | null
): boolean => {
  const autoSyncProductId = process.env.AUTO_SYNC_PRODUCT_ID;
  return (
    autoSyncProductId != null &&
    autoSyncProductId !== '' &&
    heldProductId === autoSyncProductId &&
    incomingProductId !== autoSyncProductId
  );
};

// One row holds one plan per address. Another plan ending says nothing about
// the plan the row holds, and an older plan coming back must not take the row
// from Auto Sync, whose access reads stripe_product_id.
const rowKeepsItsPlan = async (
  db: Knex,
  email: string | null,
  subscription: StripeTypes.Subscription,
  stripeProductId: string | null
): Promise<boolean> => {
  if (email == null) {
    return false;
  }
  const row = await db('subscriptions')
    .where({ email })
    .select('active', 'payload', 'stripe_product_id')
    .first();
  const heldId = planSubscriptionId(row);
  if (!row?.active || heldId == null || heldId === subscription.id) {
    return false;
  }
  if (
    planGrantsAccess(subscription) &&
    !wouldReplaceAutoSync(row.stripe_product_id, stripeProductId)
  ) {
    return false;
  }
  return heldPlanStillRuns(heldId);
};

const rowHoldsLivePlan = async (
  db: Knex,
  email: string | null,
  subscriptionId: string
): Promise<boolean> => {
  if (email == null) {
    return false;
  }
  const row = await db('subscriptions')
    .where({ email })
    .select('active', 'payload')
    .first();
  return Boolean(row?.active) && planSubscriptionId(row) === subscriptionId;
};

const periodEndOf = (subscription: StripeTypes.Subscription): number =>
  subscription.items?.data?.[0]?.current_period_end ?? 0;

// Decided 2026-11-08: when the plan a row holds ends and the payer still runs
// another, Auto Sync takes the row first (its access reads stripe_product_id),
// otherwise the plan paid furthest ahead. Developer tiers keep their own table.
const liveSuccessorPlan = async (
  db: Knex,
  customerId: string,
  endedSubscriptionId: string
): Promise<StripeTypes.Subscription | null> => {
  let listed: StripeTypes.ApiList<StripeTypes.Subscription>;
  try {
    listed = await getStripe().subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 20,
    });
  } catch (error) {
    if ((error as { code?: string }).code === 'resource_missing') {
      return null;
    }
    throw error;
  }
  const candidates: StripeTypes.Subscription[] = [];
  for (const candidate of listed.data) {
    if (candidate.id === endedSubscriptionId || !planGrantsAccess(candidate)) {
      continue;
    }
    const productId = extractProductId(candidate);
    if (productId != null && (await isDeveloperTierProduct(db, productId))) {
      continue;
    }
    candidates.push(candidate);
  }
  const autoSyncProductId = process.env.AUTO_SYNC_PRODUCT_ID;
  const isAutoSync = (candidate: StripeTypes.Subscription) =>
    autoSyncProductId != null &&
    autoSyncProductId !== '' &&
    extractProductId(candidate) === autoSyncProductId;
  candidates.sort((a, b) => {
    if (isAutoSync(a) !== isAutoSync(b)) {
      return isAutoSync(a) ? -1 : 1;
    }
    return periodEndOf(b) - periodEndOf(a);
  });
  return candidates[0] ?? null;
};

export const updateStoreSubscription = async (
  db: Knex,
  customer: StripeTypes.Customer,
  subscription: StripeTypes.Subscription
): Promise<ProvisionResult> => {
  const stripeEmail = normalizeEmail(customer.email);
  const shouldRemainActive = planGrantsAccess(subscription);

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
    await stampCustomerId(db, account, customerId);
    return account != null
      ? { status: 'linked', resolvedUserId: account.id }
      : { status: 'unlinked', resolvedUserId: null };
  }

  const keepsHeldPlan = await rowKeepsItsPlan(
    db,
    stripeEmail,
    subscription,
    stripeProductId
  );
  if (keepsHeldPlan && !shouldRemainActive) {
    return account != null
      ? { status: 'linked', resolvedUserId: account.id }
      : { status: 'unlinked', resolvedUserId: null };
  }

  if (
    !shouldRemainActive &&
    customerId != null &&
    (await rowHoldsLivePlan(db, stripeEmail, subscription.id))
  ) {
    const successor = await liveSuccessorPlan(db, customerId, subscription.id);
    if (successor != null) {
      return updateStoreSubscription(db, customer, successor);
    }
  }

  const planColumns = {
    active: shouldRemainActive,
    payload: JSON.stringify(subscription),
    stripe_product_id: stripeProductId,
  };
  const insertRow: Record<string, unknown> = {
    email: stripeEmail,
    ...planColumns,
  };
  if (linkedEmail != null) {
    insertRow.linked_email = linkedEmail;
  }

  const mergeColumns: Record<string, unknown> = {
    ...(keepsHeldPlan ? {} : planColumns),
    updated_at: new Date(),
  };
  if (linkedEmail != null) {
    mergeColumns.linked_email = linkedEmail;
  }
  // The account's own checkout on an address it has proven: a link left by an
  // earlier plan on this row must not hand this one to someone else. Unproven,
  // the link stands, or a purchase would take the row from its owner.
  if (
    account != null &&
    subscription.metadata?.user_id === String(account.id) &&
    accountEmail === stripeEmail
  ) {
    const buyer = await db('users')
      .where({ id: account.id })
      .select('email_verified')
      .first();
    if (buyer?.email_verified) {
      mergeColumns.linked_email = null;
    }
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
