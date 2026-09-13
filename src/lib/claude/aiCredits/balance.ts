import { resolveAllowance, PlanInputs, CreditWindowReset } from './allowance';

export const CREDIT_UNIT_USD = 0.01;

export interface AiCreditBalance {
  rawCredits: number;
  credits: number;
  allowance: number;
  windowStart: Date;
  windowEnd: Date;
  resets: CreditWindowReset;
}

export interface AiCreditBalanceReaders {
  getPlanInputs(userId: number, now: Date): Promise<PlanInputs | null>;
  sumActiveCredits(userId: number, now: Date): Promise<number>;
  userCostSince(userId: number, since: Date): Promise<number>;
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
  if (allowance == null) {
    return null;
  }
  const grantCredits = await readers.sumActiveCredits(userId, now);
  const spendUsd = await readers.userCostSince(userId, allowance.windowStart);
  const spentCredits = spendUsd / CREDIT_UNIT_USD;
  const rawCredits = allowance.credits + grantCredits - spentCredits;
  return {
    rawCredits,
    credits: Math.max(0, Math.round(rawCredits)),
    allowance: allowance.credits,
    windowStart: allowance.windowStart,
    windowEnd: allowance.windowEnd,
    resets: allowance.resets,
  };
}
