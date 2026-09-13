import {
  PASS_DURATION_MS,
  AnonymousPassKind,
  isAnonymousPassKind,
} from '../../../usecases/passes/passDurations';
import { startOfMonthUtc } from '../../User/startOfMonthUtc';

export type CreditWindowReset = 'period' | 'pass' | 'month';

export interface SubscriptionPlanInputs {
  periodStart: Date | null;
  periodEnd: Date | null;
  unitAmount: number | null;
}

export interface PlanInputs {
  pass: {
    kind: string;
    earliestExpiresAt: Date;
    latestExpiresAt: Date;
  } | null;
  subscription: SubscriptionPlanInputs | null;
  patreon: boolean;
  ankifyAccess: boolean;
}

export interface AiCreditAllowance {
  credits: number;
  windowStart: Date;
  windowEnd: Date | null;
  resets: CreditWindowReset;
}

const PASS_CREDITS: Record<AnonymousPassKind, number> = {
  '24h': 300,
  '7d': 500,
  '120d': 1500,
};

export const SUBSCRIPTION_CREDITS = 300;
export const LEGACY_SUBSCRIPTION_CREDITS = 100;
export const LIFETIME_CREDITS = 300;

const LEGACY_UNIT_AMOUNT_CEILING = 200;
const ROLLING_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Stacking a second pass onto an active one adds a row whose expiry is the
// prior expiry plus the duration, so anchoring the window on the latest expiry
// minus the duration slides it forward and lets earlier spend drop out of it.
// Anchor on the earliest still-active pass instead; the window runs from that
// pass's purchase time to the latest stacked expiry.
function passAllowance(
  kind: AnonymousPassKind,
  earliestExpiresAt: Date,
  latestExpiresAt: Date
): AiCreditAllowance {
  return {
    credits: PASS_CREDITS[kind],
    windowStart: new Date(earliestExpiresAt.getTime() - PASS_DURATION_MS[kind]),
    windowEnd: latestExpiresAt,
    resets: 'pass',
  };
}

function periodIsCurrent(
  periodStart: Date | null,
  periodEnd: Date | null,
  now: Date
): periodStart is Date {
  return (
    periodStart != null &&
    periodEnd != null &&
    periodStart.getTime() <= now.getTime() &&
    now.getTime() < periodEnd.getTime()
  );
}

// No period means no honest reset date, so windowEnd is null rather than a
// fabricated now-plus-30-days the account line would show as "valid through".
function rollingAllowance(credits: number, now: Date): AiCreditAllowance {
  return {
    credits,
    windowStart: new Date(now.getTime() - ROLLING_WINDOW_MS),
    windowEnd: null,
    resets: 'period',
  };
}

function startOfNextMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// Every plan draws its credits over a monthly window, not the whole billing
// period: an annual subscriber gets 300 a month, not 300 a year. The month is
// clipped to the period so the window never runs past when the plan renews.
function monthlyWindowClippedToPeriod(
  credits: number,
  periodStart: Date | null,
  periodEnd: Date | null,
  now: Date,
  resets: CreditWindowReset
): AiCreditAllowance {
  const monthStart = startOfMonthUtc(now);
  const monthEnd = startOfNextMonthUtc(now);
  const windowStart =
    periodStart != null && periodStart.getTime() > monthStart.getTime()
      ? periodStart
      : monthStart;
  const windowEnd =
    periodEnd != null && periodEnd.getTime() < monthEnd.getTime()
      ? periodEnd
      : monthEnd;
  return { credits, windowStart, windowEnd, resets };
}

function subscriptionAllowance(
  sub: SubscriptionPlanInputs,
  now: Date
): AiCreditAllowance {
  const credits =
    sub.unitAmount != null && sub.unitAmount <= LEGACY_UNIT_AMOUNT_CEILING
      ? LEGACY_SUBSCRIPTION_CREDITS
      : SUBSCRIPTION_CREDITS;
  if (periodIsCurrent(sub.periodStart, sub.periodEnd, now)) {
    return monthlyWindowClippedToPeriod(
      credits,
      sub.periodStart,
      sub.periodEnd,
      now,
      'period'
    );
  }
  return rollingAllowance(credits, now);
}

export function resolveAllowance(
  inputs: PlanInputs,
  now: Date
): AiCreditAllowance | null {
  if (inputs.subscription != null) {
    return subscriptionAllowance(inputs.subscription, now);
  }
  const pass = inputs.pass;
  if (pass != null && isAnonymousPassKind(pass.kind)) {
    return passAllowance(
      pass.kind,
      pass.earliestExpiresAt,
      pass.latestExpiresAt
    );
  }
  if (pass?.kind === 'unlimited') {
    return monthlyWindowClippedToPeriod(
      SUBSCRIPTION_CREDITS,
      null,
      pass.latestExpiresAt,
      now,
      'period'
    );
  }
  if (inputs.patreon || inputs.ankifyAccess) {
    return monthlyWindowClippedToPeriod(
      LIFETIME_CREDITS,
      null,
      null,
      now,
      'month'
    );
  }
  return null;
}
