import type StripeTypes from 'stripe';
import { getDatabase } from '../data_layer';
import { getStripe } from '../lib/integrations/stripe';
import { getDefaultEmailService } from './EmailService/EmailService';
import Subscriptions from '../data_layer/public/Subscriptions';
import { isPaused } from '../lib/subscriptions/isPaused';
import {
  isEndedStatus,
  payerAddressIsProven,
  planCustomerId,
  stripeReachOf,
} from '../lib/subscriptions/payerAddressProof';

export type CancelMode = 'immediate' | 'period_end';

const UNPAID_STATUSES: ReadonlySet<string> = new Set([
  'past_due',
  'unpaid',
  'incomplete',
  'incomplete_expired',
]);

async function softDeleteLocalSubscription(
  db: ReturnType<typeof getDatabase>,
  stripeSubscriptionId: string,
  canceledPayload: StripeTypes.Subscription
): Promise<void> {
  await db('subscriptions')
    .whereRaw("payload->>'id' = ?", [stripeSubscriptionId])
    .update({
      active: false,
      payload: JSON.stringify(canceledPayload),
      updated_at: new Date(),
    });
}

export const VALID_PAUSE_MONTHS = [1, 2, 3] as const;
export type PauseMonths = (typeof VALID_PAUSE_MONTHS)[number];
const MIN_TENURE_DAYS_TO_PAUSE = 30;
const SECONDS_PER_DAY = 24 * 60 * 60;

export class SubscriptionNotOwnedError extends Error {
  constructor() {
    super('Subscription not found');
    this.name = 'SubscriptionNotOwnedError';
  }
}

export class AnnualPlanNotPausableError extends Error {
  constructor() {
    super('Annual plans cannot be paused');
    this.name = 'AnnualPlanNotPausableError';
  }
}

export class SubscriptionTooNewToPauseError extends Error {
  constructor() {
    super('Subscription is too new to pause');
    this.name = 'SubscriptionTooNewToPauseError';
  }
}

export class InvalidPauseMonthsError extends Error {
  constructor() {
    super('Pause length must be 1, 2, or 3 months');
    this.name = 'InvalidPauseMonthsError';
  }
}

export interface PauseResult {
  subscriptionId: string;
  resumesAt: number;
  tenureDays: number;
}

const isValidPauseMonths = (months: number): months is PauseMonths =>
  (VALID_PAUSE_MONTHS as readonly number[]).includes(months);

const subscriptionInterval = (sub: StripeTypes.Subscription): string | null =>
  sub.items?.data?.[0]?.price?.recurring?.interval ?? null;

const tenureDaysOf = (sub: StripeTypes.Subscription, now: Date): number =>
  Math.floor(
    (Math.floor(now.getTime() / 1000) - sub.created) / SECONDS_PER_DAY
  );

const resumesAtEpoch = (now: Date, months: PauseMonths): number => {
  const resumeDate = new Date(now.getTime());
  resumeDate.setMonth(resumeDate.getMonth() + months);
  return Math.floor(resumeDate.getTime() / 1000);
};

async function collectLinkedPayerEmails(normalized: string): Promise<string[]> {
  const linked: Array<{ email: string }> = await getDatabase()('subscriptions')
    .select('email')
    .where({ linked_email: normalized });
  return linked
    .filter((row) => row.email)
    .map((row) => row.email.toLowerCase());
}

async function findStripeCustomersByEmail(
  stripe: ReturnType<typeof getStripe>,
  email: string
): Promise<StripeTypes.Customer[]> {
  const listed = await stripe.customers.list({ email, limit: 10 });
  if (listed.data.length > 0) {
    return listed.data;
  }

  const escaped = email.replace(/(['\\])/g, '\\$1');
  const searched = await stripe.customers.search({
    query: `email:'${escaped}'`,
    limit: 10,
  });
  return searched.data;
}

async function listStripeSubscriptionsAt(
  addresses: string[],
  status: StripeTypes.SubscriptionListParams['status']
): Promise<StripeTypes.Subscription[]> {
  const stripe = getStripe();

  const seen = new Set<string>();
  const subs: StripeTypes.Subscription[] = [];

  for (const email of addresses) {
    const customers = await findStripeCustomersByEmail(stripe, email);
    for (const customer of customers) {
      const list = await stripe.subscriptions.list({
        customer: customer.id,
        status,
        limit: 10,
      });
      for (const sub of list.data) {
        if (!seen.has(sub.id)) {
          seen.add(sub.id);
          subs.push(sub);
        }
      }
    }
  }

  return subs;
}

async function listStripeSubscriptionsOfCustomer(
  customerId: string,
  status: StripeTypes.SubscriptionListParams['status']
): Promise<StripeTypes.Subscription[]> {
  try {
    const list = await getStripe().subscriptions.list({
      customer: customerId,
      status,
      limit: 10,
    });
    return list.data;
  } catch (error) {
    if ((error as { code?: string }).code === 'resource_missing') {
      return [];
    }
    throw error;
  }
}

async function listStripeSubscriptionsFor(
  userEmail: string,
  status: StripeTypes.SubscriptionListParams['status']
): Promise<StripeTypes.Subscription[]> {
  const normalized = userEmail.toLowerCase();
  const db = getDatabase();
  const reach = await stripeReachOf(db, normalized);
  // A row linked to this account names the plan's customer. Searching its payer
  // address instead would show every other customer on that address.
  const linkedRows: Array<{ email: string; payload?: unknown }> = await db(
    'subscriptions'
  )
    .select('email', 'payload')
    .where({ linked_email: normalized });
  const customers = new Set<string>(
    reach.customerId == null ? [] : [reach.customerId]
  );
  const addresses = new Set<string>(reach.byAddress ? [normalized] : []);
  for (const row of linkedRows) {
    const customer = planCustomerId(row);
    if (customer != null) {
      customers.add(customer);
    } else if (row.email) {
      addresses.add(row.email.toLowerCase());
    }
  }

  const atAddresses = await listStripeSubscriptionsAt([...addresses], status);
  const seen = new Set(atAddresses.map((sub) => sub.id));
  const subs = [...atAddresses];
  for (const customer of customers) {
    for (const sub of await listStripeSubscriptionsOfCustomer(
      customer,
      status
    )) {
      if (!seen.has(sub.id)) {
        seen.add(sub.id);
        subs.push(sub);
      }
    }
  }
  return subs;
}

export class SubscriptionService {
  static findActiveStripeSubscriptions(
    userEmail: string
  ): Promise<StripeTypes.Subscription[]> {
    return listStripeSubscriptionsFor(userEmail, 'active');
  }

  static findRecentStripeSubscriptions(
    userEmail: string
  ): Promise<StripeTypes.Subscription[]> {
    return listStripeSubscriptionsFor(userEmail, 'all');
  }

  // Deleting the account would leave these billing with nobody to stop them:
  // open plans on its address that this account may not cancel.
  static async hasPlanOutOfReach(userEmail: string): Promise<boolean> {
    const normalized = userEmail.toLowerCase();
    const reach = await stripeReachOf(getDatabase(), normalized);
    if (reach.byAddress) {
      return false;
    }
    const reachable = await this.findRecentStripeSubscriptions(normalized);
    const reachableIds = new Set(reachable.map((sub) => sub.id));
    const atAddress = await listStripeSubscriptionsAt([normalized], 'all');
    return atAddress.some(
      (sub) => !isEndedStatus(sub.status) && !reachableIds.has(sub.id)
    );
  }

  // The ops delete preview: anything live on a typed address, proven or not.
  static async addressHoldsPlan(address: string): Promise<boolean> {
    const normalized = address.toLowerCase();
    const row = await getDatabase()('subscriptions')
      .where(function () {
        this.where({ email: normalized }).orWhere({ linked_email: normalized });
      })
      .andWhere({ active: true })
      .select('id')
      .first();
    if (row != null) {
      return true;
    }
    const subs = await this.findActiveStripeSubscriptionsForAddress(normalized);
    return subs.length > 0;
  }

  // For an address typed by someone other than its account: the claim flow
  // proves the mailbox with an emailed link, and ops acts on a typed address.
  static async findActiveStripeSubscriptionsForAddress(
    address: string
  ): Promise<StripeTypes.Subscription[]> {
    const normalized = address.toLowerCase();
    const linked = await collectLinkedPayerEmails(normalized);
    return listStripeSubscriptionsAt(
      [...new Set([normalized, ...linked])],
      'active'
    );
  }

  // Returns the mode applied to each subscription it processed, so a caller
  // can record and report what happened (a paused plan ends now even when
  // the requested mode is period_end).
  static async cancelUserSubscriptions(
    userEmail: string,
    mode: CancelMode = 'period_end',
    allStatuses = false,
    sendEmail = true
  ): Promise<CancelMode[]> {
    const allSubs = allStatuses
      ? await this.findRecentStripeSubscriptions(userEmail)
      : await this.findActiveStripeSubscriptions(userEmail);
    const subs = allStatuses
      ? allSubs.filter((s) => s.status !== 'canceled')
      : allSubs;
    return this.cancelSubscriptions(subs, userEmail, mode, sendEmail);
  }

  // Ops deletes the account on a typed address, proven or not, so it ends every
  // live plan there: nothing else can stop them billing once the account goes.
  static async cancelEverySubscriptionAtAddress(
    address: string
  ): Promise<CancelMode[]> {
    const normalized = address.toLowerCase();
    const linked = await collectLinkedPayerEmails(normalized);
    const subs = await listStripeSubscriptionsAt(
      [...new Set([normalized, ...linked])],
      'all'
    );
    return this.cancelSubscriptions(
      subs.filter((s) => s.status !== 'canceled'),
      normalized,
      'immediate',
      true
    );
  }

  private static async cancelSubscriptions(
    subs: StripeTypes.Subscription[],
    userEmail: string,
    mode: CancelMode,
    sendEmail: boolean
  ): Promise<CancelMode[]> {
    const stripe = getStripe();
    const emailService = getDefaultEmailService();

    console.log(
      `Found ${subs.length} active Stripe subscription(s) to process`
    );

    const db = getDatabase();
    const applied: CancelMode[] = [];

    for (const sub of subs) {
      // A paused subscription has no paid period in progress (its invoices
      // are voided and paid features are off), so there is nothing to keep
      // open until a period end: it ends now.
      const endsNow = mode === 'immediate' || isPaused(sub);
      applied.push(endsNow ? 'immediate' : 'period_end');
      if (endsNow) {
        console.log(`Cancelling Stripe subscription ${sub.id} immediately`);
        const canceled = await stripe.subscriptions.cancel(sub.id);
        await softDeleteLocalSubscription(db, sub.id, canceled);
        if (sendEmail) {
          await emailService.sendSubscriptionCancelledEmail(
            userEmail,
            '',
            sub.id
          );
        }
      } else {
        console.log(
          `Scheduling cancellation at period end for Stripe subscription ${sub.id}`
        );
        const updated = await stripe.subscriptions.update(sub.id, {
          cancel_at_period_end: true,
        });
        const cancelAt = updated.cancel_at ?? sub.cancel_at;
        if (sendEmail && cancelAt) {
          await emailService.sendSubscriptionScheduledCancellationEmail(
            userEmail,
            '',
            new Date(cancelAt * 1000)
          );
        }
      }
    }

    return applied;
  }

  // The caller never picks the mode. A plan with a paid period in progress is
  // scheduled to end with that period; one with no paid period to honour (an
  // unpaid status, or a pause with its invoices voided) ends now. Returns the
  // mode that was applied so the caller can record it.
  static async cancelSubscriptionById(
    callerEmail: string,
    id: string
  ): Promise<CancelMode> {
    const owned = await this.findRecentStripeSubscriptions(callerEmail);
    const target = owned.find((sub) => sub.id === id);
    if (target == null) {
      throw new SubscriptionNotOwnedError();
    }

    const stripe = getStripe();
    const endsNow = isPaused(target) || UNPAID_STATUSES.has(target.status);

    if (endsNow) {
      const canceled = await stripe.subscriptions.cancel(id);
      await softDeleteLocalSubscription(getDatabase(), id, canceled);
    } else {
      await stripe.subscriptions.update(id, { cancel_at_period_end: true });
    }

    console.log('subscription_self_serve_extra_cancel');
    return endsNow ? 'immediate' : 'period_end';
  }

  static async pauseSubscription(
    userEmail: string,
    months: number,
    now: Date = new Date()
  ): Promise<PauseResult> {
    if (!isValidPauseMonths(months)) {
      throw new InvalidPauseMonthsError();
    }

    const active = await this.findActiveStripeSubscriptions(userEmail);
    const target = active.find((sub) => !isPaused(sub));
    if (target == null) {
      throw new SubscriptionNotOwnedError();
    }

    if (subscriptionInterval(target) === 'year') {
      throw new AnnualPlanNotPausableError();
    }

    const tenureDays = tenureDaysOf(target, now);
    if (tenureDays < MIN_TENURE_DAYS_TO_PAUSE) {
      throw new SubscriptionTooNewToPauseError();
    }

    const resumesAt = resumesAtEpoch(now, months);
    const stripe = getStripe();
    await stripe.subscriptions.update(target.id, {
      pause_collection: { behavior: 'void', resumes_at: resumesAt },
    });

    return { subscriptionId: target.id, resumesAt, tenureDays };
  }

  static async resumeSubscription(userEmail: string): Promise<string> {
    const recent = await this.findRecentStripeSubscriptions(userEmail);
    const target = recent.find((sub) => isPaused(sub));
    if (target == null) {
      throw new SubscriptionNotOwnedError();
    }

    const stripe = getStripe();
    await stripe.subscriptions.update(target.id, {
      pause_collection: '',
    });

    return target.id;
  }

  static async getUserActiveSubscriptions(
    userEmail: string
  ): Promise<Subscriptions[]> {
    const database = getDatabase();
    const normalized = userEmail.toLowerCase();
    const provenPayer = await payerAddressIsProven(database, normalized);

    return database('subscriptions')
      .where(function () {
        this.where({ linked_email: normalized });
        if (provenPayer) {
          this.orWhere({ email: normalized });
        }
      })
      .andWhere({ active: true });
  }

  static async countActiveByProductId(productId: string): Promise<number> {
    const database = getDatabase();
    const rows = await database('subscriptions')
      .where({ active: true, stripe_product_id: productId })
      .count<[{ count: string }]>('id as count');
    return Number.parseInt(rows[0]?.count ?? '0', 10);
  }

  async deactivateSubscription(subscriptionId: number): Promise<void> {
    const database = getDatabase();

    await database('subscriptions')
      .where({ id: subscriptionId })
      .update({ active: false, updated_at: new Date() });
  }
}

export default SubscriptionService;
