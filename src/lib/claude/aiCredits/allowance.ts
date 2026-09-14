import {
  AnonymousPassKind,
  isAnonymousPassKind,
} from '../../../usecases/passes/passDurations';
import {
  startOfMonthUtc,
  startOfNextMonthUtc,
} from '../../User/startOfMonthUtc';

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

// Adds whole months, clamping the day of month so a day 29-31 anchor never
// overflows into the next month (Jan 31 + 1 month → Feb 28, not Mar 3).
function addMonthsUtc(date: Date, months: number): Date {
  const targetYear = date.getUTCFullYear();
  const targetMonth = date.getUTCMonth() + months;
  const lastDayOfTarget = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0)
  ).getUTCDate();
  const day = Math.min(date.getUTCDate(), lastDayOfTarget);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
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
  const anniversary = addMonthsUtc(periodStart, months);
  // Clamp to now so a day-clamp rounding can never start the window ahead of
  // the clock (mirrors the pass path).
  const windowStart = anniversary.getTime() > now.getTime() ? now : anniversary;
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

function passAllowanceOf(
  pass: PlanInputs['pass'],
  now: Date
): AiCreditAllowance | null {
  if (pass == null) {
    return null;
  }
  if (isAnonymousPassKind(pass.kind)) {
    return passAllowance(pass.kind, pass.windowStart, pass.windowEnd);
  }
  if (pass.kind === 'unlimited') {
    return calendarMonthWindow(
      SUBSCRIPTION_CREDITS,
      now,
      'period',
      pass.windowEnd
    );
  }
  return null;
}

export function resolveAllowance(
  inputs: PlanInputs,
  now: Date
): AiCreditAllowance | null {
  const subscription =
    inputs.subscription != null
      ? subscriptionAllowance(inputs.subscription, now)
      : null;
  const pass = passAllowanceOf(inputs.pass, now);
  // A subscriber who also bought a pass paid for both: sum the credits over the
  // active pass window rather than handing back only the subscription.
  if (subscription != null && pass != null) {
    return {
      credits: subscription.credits + pass.credits,
      windowStart: pass.windowStart,
      windowEnd: pass.windowEnd,
      resets: pass.resets,
    };
  }
  if (subscription != null) {
    return subscription;
  }
  if (pass != null) {
    return pass;
  }
  if (inputs.patreon || inputs.ankifyAccess) {
    return calendarMonthWindow(LIFETIME_CREDITS, now, 'month', null);
  }
  return null;
}
