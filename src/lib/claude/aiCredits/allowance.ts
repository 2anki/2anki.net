import {
  PASS_DURATION_MS,
  AnonymousPassKind,
  isAnonymousPassKind,
} from '../../../usecases/passes/passDurations';

export type CreditWindowReset = 'period' | 'pass' | 'month';

export interface SubscriptionPlanInputs {
  active: boolean;
  periodStart: Date | null;
  periodEnd: Date | null;
  unitAmount: number | null;
}

export interface PlanInputs {
  pass: { kind: string; expiresAt: Date } | null;
  subscription: SubscriptionPlanInputs | null;
  patreon: boolean;
  ankifyAccess: boolean;
}

export interface AiCreditAllowance {
  credits: number;
  windowStart: Date;
  windowEnd: Date;
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

function passAllowance(
  kind: AnonymousPassKind,
  expiresAt: Date
): AiCreditAllowance {
  return {
    credits: PASS_CREDITS[kind],
    windowStart: new Date(expiresAt.getTime() - PASS_DURATION_MS[kind]),
    windowEnd: expiresAt,
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

function rollingAllowance(credits: number, now: Date): AiCreditAllowance {
  return {
    credits,
    windowStart: new Date(now.getTime() - ROLLING_WINDOW_MS),
    windowEnd: new Date(now.getTime() + ROLLING_WINDOW_MS),
    resets: 'period',
  };
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
    return {
      credits,
      windowStart: sub.periodStart,
      windowEnd: sub.periodEnd as Date,
      resets: 'period',
    };
  }
  return rollingAllowance(credits, now);
}

function calendarMonthAllowance(credits: number, now: Date): AiCreditAllowance {
  return {
    credits,
    windowStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    windowEnd: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    ),
    resets: 'month',
  };
}

export function resolveAllowance(
  inputs: PlanInputs,
  now: Date
): AiCreditAllowance | null {
  if (inputs.subscription?.active === true) {
    return subscriptionAllowance(inputs.subscription, now);
  }
  const pass = inputs.pass;
  if (pass != null && isAnonymousPassKind(pass.kind)) {
    return passAllowance(pass.kind, pass.expiresAt);
  }
  if (pass != null && pass.kind === 'unlimited') {
    return rollingAllowance(SUBSCRIPTION_CREDITS, now);
  }
  if (inputs.patreon || inputs.ankifyAccess) {
    return calendarMonthAllowance(LIFETIME_CREDITS, now);
  }
  return null;
}
