import { resolveAllowance, PlanInputs, CreditWindowReset } from './allowance';

export const CREDIT_UNIT_USD = 0.01;

export interface AiCreditBalance {
  rawCredits: number;
  credits: number;
  spent: number;
  allowance: number;
  windowStart: Date;
  windowEnd: Date | null;
  resets: CreditWindowReset;
}

export interface GrantWindow {
  windowStart: Date;
  windowEnd: Date;
}

export interface AiCreditBalanceReaders {
  getPlanInputs(userId: number, now: Date): Promise<PlanInputs | null>;
  sumActiveCredits(userId: number, now: Date): Promise<number>;
  activeGrantWindow(userId: number, now: Date): Promise<GrantWindow | null>;
  userCostSince(userId: number, since: Date): Promise<number>;
}

function buildBalance(
  allowanceCredits: number,
  grantCredits: number,
  spendUsd: number,
  windowStart: Date,
  windowEnd: Date | null,
  resets: CreditWindowReset
): AiCreditBalance {
  const spentCredits = spendUsd / CREDIT_UNIT_USD;
  const rawCredits = allowanceCredits + grantCredits - spentCredits;
  return {
    rawCredits,
    credits: Math.max(0, Math.round(rawCredits)),
    spent: Math.max(0, Math.round(spentCredits)),
    allowance: allowanceCredits,
    windowStart,
    windowEnd,
    resets,
  };
}

// A user with unexpired pack credits but no active plan still owns a real
// balance — it just cannot be spent until they resubscribe. Building it purely
// from the grant (zero plan allowance, the grant's own earliest-anchor to
// latest-expiry window, spend counted from that start) is what keeps a paused
// pack visible on the account page instead of vanishing when the plan lapses.
async function computeGrantOnlyBalance(
  userId: number,
  now: Date,
  grantCredits: number,
  readers: AiCreditBalanceReaders
): Promise<AiCreditBalance | null> {
  if (grantCredits <= 0) {
    return null;
  }
  const window = await readers.activeGrantWindow(userId, now);
  if (window == null) {
    return null;
  }
  const spendUsd = await readers.userCostSince(userId, window.windowStart);
  return buildBalance(
    0,
    grantCredits,
    spendUsd,
    window.windowStart,
    window.windowEnd,
    'pass'
  );
}

export async function computeAiCreditBalance(
  userId: number,
  now: Date,
  readers: AiCreditBalanceReaders
): Promise<AiCreditBalance | null> {
  const inputs = await readers.getPlanInputs(userId, now);
  if (inputs == null) {
    return null;
  }
  const allowance = resolveAllowance(inputs, now);
  if (allowance != null) {
    const [grantCredits, spendUsd] = await Promise.all([
      readers.sumActiveCredits(userId, now),
      readers.userCostSince(userId, allowance.windowStart),
    ]);
    return buildBalance(
      allowance.credits,
      grantCredits,
      spendUsd,
      allowance.windowStart,
      allowance.windowEnd,
      allowance.resets
    );
  }
  const grantCredits = await readers.sumActiveCredits(userId, now);
  return computeGrantOnlyBalance(userId, now, grantCredits, readers);
}
