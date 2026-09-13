import {
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
    windowStart: Date;
    windowEnd: Date;
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

// The pass window is already resolved upstream (pickActivePassWindow anchors it
// on the earliest active purchase and clamps to now), so the allowance just
// carries it through with the kind's credits.
function passAllowance(
  kind: AnonymousPassKind,
  windowStart: Date,
  windowEnd: Date
): AiCreditAllowance {
  return {
    credits: PASS_CREDITS[kind],
    windowStart,
    windowEnd,
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

function addMonthsUtc(date: Date, months: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + months,
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
}

function startOfNextMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// One reset cadence, anchored on the billing day: the window is the n-th month
// from periodStart that contains now, clipped to periodEnd. A monthly plan's
// single month equals its whole period; an annual plan gets a fresh window each
// billing-day anniversary. Anchoring on the calendar month AND the period was
// the double-reset bug for anyone who renews off the 1st.
function subscriptionMonthlyWindow(
  credits: number,
  periodStart: Date,
  periodEnd: Date,
  now: Date
): AiCreditAllowance {
  let months =
    (now.getUTCFullYear() - periodStart.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - periodStart.getUTCMonth());
  if (addMonthsUtc(periodStart, months).getTime() > now.getTime()) {
    months -= 1;
  }
  const windowStart = addMonthsUtc(periodStart, months);
  const nextAnniversary = addMonthsUtc(periodStart, months + 1);
  const windowEnd =
    nextAnniversary.getTime() < periodEnd.getTime()
      ? nextAnniversary
      : periodEnd;
  return { credits, windowStart, windowEnd, resets: 'period' };
}

// A calendar-month window, optionally clipped to a plan end (the Apple
// unlimited pass anchors on its own expiry). Single cadence: the calendar month.
function calendarMonthWindow(
  credits: number,
  now: Date,
  resets: CreditWindowReset,
  clipEnd: Date | null
): AiCreditAllowance {
  const monthStart = startOfMonthUtc(now);
  const monthEnd = startOfNextMonthUtc(now);
  const windowEnd =
    clipEnd != null && clipEnd.getTime() < monthEnd.getTime()
      ? clipEnd
      : monthEnd;
  return { credits, windowStart: monthStart, windowEnd, resets };
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
    return subscriptionMonthlyWindow(
      credits,
      sub.periodStart,
      sub.periodEnd as Date,
      now
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
    return passAllowance(pass.kind, pass.windowStart, pass.windowEnd);
  }
  if (pass?.kind === 'unlimited') {
    return calendarMonthWindow(
      SUBSCRIPTION_CREDITS,
      now,
      'period',
      pass.windowEnd
    );
  }
  if (inputs.patreon || inputs.ankifyAccess) {
    return calendarMonthWindow(LIFETIME_CREDITS, now, 'month', null);
  }
  return null;
}
