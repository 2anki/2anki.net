import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import { getDatabase } from '../data_layer';
import { getStripe } from '../lib/integrations/stripe';
import { getDefaultEmailService } from './EmailService/EmailService';
import Subscriptions from '../data_layer/public/Subscriptions';
import { isPaused } from '../lib/subscriptions/isPaused';

export type CancelMode = 'immediate' | 'period_end';

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

async function listStripeSubscriptionsFor(
  userEmail: string,
  status: StripeTypes.SubscriptionListParams['status']
): Promise<StripeTypes.Subscription[]> {
  const stripe = getStripe();
  const candidateEmails = await collectCandidateEmails(userEmail);

  const seen = new Set<string>();
  const subs: StripeTypes.Subscription[] = [];

  for (const email of candidateEmails) {
    const customers = await stripe.customers.list({ email, limit: 10 });
    for (const customer of customers.data) {
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
      if (mode === 'immediate') {
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

  static async cancelSubscriptionById(
    callerEmail: string,
    id: string,
    mode: CancelMode
  ): Promise<void> {
    const owned = await this.findRecentStripeSubscriptions(callerEmail);
    const isOwned = owned.some((sub) => sub.id === id);
    if (!isOwned) {
      throw new SubscriptionNotOwnedError();
    }

    const stripe = getStripe();

    if (mode === 'immediate') {
      const canceled = await stripe.subscriptions.cancel(id);
      await softDeleteLocalSubscription(getDatabase(), id, canceled);
    } else {
      await stripe.subscriptions.update(id, { cancel_at_period_end: true });
    }

    console.log('subscription_self_serve_extra_cancel');
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
