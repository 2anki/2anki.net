import type { Stripe } from 'stripe';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

import { getStripe } from '../../lib/integrations/stripe';

export interface MissingPassPayment {
  sessionId: string;
  paymentIntentId: string | null;
  kind: string;
  anonymous: boolean;
  createdAt: string;
  amountTotal: number | null;
  currency: string | null;
}

export interface PassUnlockMonitorResponse {
  window_since: string;
  as_of: string;
  grace_minutes: number;
  checked: number;
  granted: number;
  missing: number;
  pending: number;
  missingPayments: MissingPassPayment[];
  error?: string;
}

export interface UserPassLookupSource {
  existsByPaymentIntentId(paymentIntentId: string): Promise<boolean>;
}

export interface AnonymousPassLookupSource {
  findBySessionId(sessionId: string): Promise<{ id: number } | null>;
}

interface PassUnlockMonitorServiceDeps {
  userPasses: UserPassLookupSource;
  anonymousPasses: AnonymousPassLookupSource;
  stripeFactory?: () => Stripe;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const GRACE_MINUTES = 15;
const GRACE_MS = GRACE_MINUTES * 60 * 1000;
const PASS_KINDS = new Set(['24h', '7d', '120d']);

function paymentIntentIdOf(
  session: StripeTypes.Checkout.Session
): string | null {
  const intent = session.payment_intent;
  if (typeof intent === 'string') return intent;
  return intent?.id ?? null;
}

function isCompletedPassSession(
  session: StripeTypes.Checkout.Session
): boolean {
  const kind = session.metadata?.pass_kind;
  return (
    session.status === 'complete' &&
    session.payment_status === 'paid' &&
    kind != null &&
    PASS_KINDS.has(kind)
  );
}

export class PassUnlockMonitorService {
  private readonly userPasses: UserPassLookupSource;
  private readonly anonymousPasses: AnonymousPassLookupSource;
  private readonly stripeFactory: () => Stripe;

  constructor(deps: PassUnlockMonitorServiceDeps) {
    this.userPasses = deps.userPasses;
    this.anonymousPasses = deps.anonymousPasses;
    this.stripeFactory = deps.stripeFactory ?? (() => getStripe());
  }

  async getStatus(since: Date, now: Date): Promise<PassUnlockMonitorResponse> {
    const base: PassUnlockMonitorResponse = {
      window_since: since.toISOString(),
      as_of: now.toISOString(),
      grace_minutes: GRACE_MINUTES,
      checked: 0,
      granted: 0,
      missing: 0,
      pending: 0,
      missingPayments: [],
    };

    try {
      const sessions = await this.listPassSessions(since);
      return await this.reconcile(sessions, now, base);
    } catch (err) {
      return {
        ...base,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async listPassSessions(
    since: Date
  ): Promise<StripeTypes.Checkout.Session[]> {
    const stripe = this.stripeFactory();
    const gte = Math.floor(since.getTime() / 1000);
    const collected: StripeTypes.Checkout.Session[] = [];
    let startingAfter: string | undefined;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params: StripeTypes.Checkout.SessionListParams = {
        created: { gte },
        limit: PAGE_SIZE,
      };
      if (startingAfter != null) {
        params.starting_after = startingAfter;
      }
      const response = await stripe.checkout.sessions.list(params);
      collected.push(...response.data.filter(isCompletedPassSession));
      if (!response.has_more || response.data.length === 0) {
        break;
      }
      startingAfter = response.data[response.data.length - 1]?.id;
    }

    return collected;
  }

  private async reconcile(
    sessions: StripeTypes.Checkout.Session[],
    now: Date,
    base: PassUnlockMonitorResponse
  ): Promise<PassUnlockMonitorResponse> {
    const graceCutoff = now.getTime() - GRACE_MS;
    let granted = 0;
    let pending = 0;
    const missingPayments: MissingPassPayment[] = [];

    for (const session of sessions) {
      if (session.created * 1000 > graceCutoff) {
        pending += 1;
        continue;
      }
      const anonymous = session.metadata?.pass_anonymous === '1';
      const hasPass = await this.hasPass(session, anonymous);
      if (hasPass) {
        granted += 1;
        continue;
      }
      missingPayments.push(toMissingPayment(session, anonymous));
    }

    return {
      ...base,
      checked: granted + missingPayments.length,
      granted,
      missing: missingPayments.length,
      pending,
      missingPayments,
    };
  }

  private async hasPass(
    session: StripeTypes.Checkout.Session,
    anonymous: boolean
  ): Promise<boolean> {
    if (anonymous) {
      const row = await this.anonymousPasses.findBySessionId(session.id);
      return row != null;
    }
    const paymentIntentId = paymentIntentIdOf(session);
    if (paymentIntentId == null) return false;
    return this.userPasses.existsByPaymentIntentId(paymentIntentId);
  }
}

function toMissingPayment(
  session: StripeTypes.Checkout.Session,
  anonymous: boolean
): MissingPassPayment {
  return {
    sessionId: session.id,
    paymentIntentId: paymentIntentIdOf(session),
    kind: session.metadata?.pass_kind ?? '',
    anonymous,
    createdAt: new Date(session.created * 1000).toISOString(),
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
  };
}
