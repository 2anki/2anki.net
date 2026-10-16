import type StripeTypes from 'stripe';
import { getDatabase } from '../data_layer';
import { getStripe } from '../lib/integrations/stripe';
import { getDefaultEmailService } from './EmailService/EmailService';
import Subscriptions from '../data_layer/public/Subscriptions';
import { isPaused } from '../lib/subscriptions/isPaused';

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

async function collectCandidateEmails(userEmail: string): Promise<string[]> {
  const normalized = userEmail.toLowerCase();
  const db = getDatabase();
  const linked: Array<{ email: string }> = await db('subscriptions')
    .select('email')
    .where({ linked_email: normalized });

  const emails = new Set<string>([normalized]);
  for (const row of linked) {
    if (row.email) {
      emails.add(row.email.toLowerCase());
    }
  }
  return [...emails];
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

async function listStripeSubscriptionsFor(
  userEmail: string,
  status: StripeTypes.SubscriptionListParams['status']
): Promise<StripeTypes.Subscription[]> {
  const stripe = getStripe();
  const candidateEmails = await collectCandidateEmails(userEmail);

  const seen = new Set<string>();
  const subs: StripeTypes.Subscription[] = [];

  for (const email of candidateEmails) {
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

  static async cancelUserSubscriptions(
    userEmail: string,
    mode: CancelMode = 'period_end',
    allStatuses = false,
    sendEmail = true
  ): Promise<number> {
    const stripe = getStripe();
    const emailService = getDefaultEmailService();
    const allSubs = allStatuses
      ? await this.findRecentStripeSubscriptions(userEmail)
      : await this.findActiveStripeSubscriptions(userEmail);
    const subs = allStatuses
      ? allSubs.filter((s) => s.status !== 'canceled')
      : allSubs;

    console.log(
      `Found ${subs.length} active Stripe subscription(s) to process`
    );

    const db = getDatabase();

    for (const sub of subs) {
      // A paused subscription has no paid period in progress (its invoices
      // are voided and paid features are off), so there is nothing to keep
      // open until a period end: it ends now.
      const endsNow = mode === 'immediate' || isPaused(sub);
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

    return subs.length;
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

    return database('subscriptions')
      .where(function () {
        this.where({ email: userEmail.toLowerCase() }).orWhere({
          linked_email: userEmail.toLowerCase(),
        });
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
