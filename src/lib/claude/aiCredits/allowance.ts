import {
  AnonymousPassKind,
  PASS_DURATION_MS,
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

// One row per purchased pass that has not yet expired. Each row carries its own
// window ([expiresAt − duration, expiresAt]) and its own credits — no stacking
// arithmetic across rows, no created_at.
export interface ActivePassRow {
  kind: string;
  expiresAt: Date;
}

export interface PlanInputs {
  passes: ActivePassRow[];
  subscriptions: SubscriptionPlanInputs[];
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

// Each anonymous pass row active now contributes its own credits over its own
// [expiresAt − duration, expiresAt] window. Credits are summed across the rows
// whose window contains now; spend counts from the earliest such start and the
// window ends at the latest such expiry. A row not yet started or already
// expired contributes nothing.
function anonymousPassAllowance(
  passes: ActivePassRow[],
  now: Date
): AiCreditAllowance | null {
  let credits = 0;
  let windowStart: number | null = null;
  let windowEnd: number | null = null;
  for (const row of passes) {
    if (!isAnonymousPassKind(row.kind)) {
      continue;
    }
    const end = row.expiresAt.getTime();
    const start = end - PASS_DURATION_MS[row.kind];
    if (start > now.getTime() || now.getTime() >= end) {
      continue;
    }
    credits += PASS_CREDITS[row.kind];
    windowStart = windowStart == null ? start : Math.min(windowStart, start);
    windowEnd = windowEnd == null ? end : Math.max(windowEnd, end);
  }
  if (windowStart == null || windowEnd == null) {
    return null;
  }
  return {
    credits,
    windowStart: new Date(windowStart),
    windowEnd: new Date(windowEnd),
    resets: 'pass',
  };
}

function unlimitedPassAllowance(
  passes: ActivePassRow[],
  now: Date
): AiCreditAllowance | null {
  const active = passes.find(
    (row) => row.kind === 'unlimited' && row.expiresAt.getTime() > now.getTime()
  );
  if (active == null) {
    return null;
  }
  return calendarMonthWindow(
    SUBSCRIPTION_CREDITS,
    now,
    'period',
    active.expiresAt
  );
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
  passes: ActivePassRow[],
  now: Date
): AiCreditAllowance | null {
  return (
    anonymousPassAllowance(passes, now) ?? unlimitedPassAllowance(passes, now)
  );
}

// Picks the allowance that grants more credits, breaking ties in favour of the
// first argument. Not summing — each candidate carries its own window and spend
// is only ever counted against that one window.
function betterAllowance(
  a: AiCreditAllowance | null,
  b: AiCreditAllowance | null
): AiCreditAllowance | null {
  if (a == null) {
    return b;
  }
  if (b == null) {
    return a;
  }
  return b.credits > a.credits ? b : a;
}

// Evaluates every active subscription row and keeps the one granting the most
// credits, so a stale legacy row never hides the real plan's allowance.
function bestSubscriptionAllowance(
  subscriptions: SubscriptionPlanInputs[],
  now: Date
): AiCreditAllowance | null {
  return subscriptions.reduce<AiCreditAllowance | null>(
    (best, sub) => betterAllowance(best, subscriptionAllowance(sub, now)),
    null
  );
}

// The paying tiers do not sum: a subscriber who also holds a pass draws
// whichever grants more credits (a 1500-credit pass beats a legacy $2 sub's
// 100), never both. Lifetime is the floor, used only when no active
// subscription or pass applies.
export function resolveAllowance(
  inputs: PlanInputs,
  now: Date
): AiCreditAllowance | null {
  const subscription = bestSubscriptionAllowance(inputs.subscriptions, now);
  const pass = passAllowanceOf(inputs.passes, now);
  const paid = betterAllowance(subscription, pass);
  if (paid != null) {
    return paid;
  }
  if (inputs.patreon || inputs.ankifyAccess) {
    return calendarMonthWindow(LIFETIME_CREDITS, now, 'month', null);
  }
  return null;
}
