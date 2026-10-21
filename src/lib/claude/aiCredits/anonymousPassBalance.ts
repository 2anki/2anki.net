import { isAnonymousPassKind } from '../../../usecases/passes/passDurations';
import { PlanInputs, resolveAllowance } from './allowance';
import { AiCreditBalance, buildBalance } from './balance';

export interface AnonymousPassRow {
  kind: string;
  expiresAt: Date;
}

export interface AnonymousPassBalanceReaders {
  getPass(anonymousPassId: number): Promise<AnonymousPassRow | null>;
  passCostSince(anonymousPassId: number, since: Date): Promise<number>;
}

// The credit balance of one purchased anonymous pass, valued exactly like a
// claimed pass row: the pass kind's allowance over its [expiresAt − duration,
// expiresAt] window, minus the AI spend recorded against that pass id in the
// same window. No grants — an anonymous pass cannot hold credit packs. Returns
// null for an unknown, expired, or non-metered pass so the caller fails open,
// matching the signed-in guard's null-balance behaviour.
export async function computeAnonymousPassBalance(
  anonymousPassId: number,
  now: Date,
  readers: AnonymousPassBalanceReaders
): Promise<AiCreditBalance | null> {
  const pass = await readers.getPass(anonymousPassId);
  if (pass == null || !isAnonymousPassKind(pass.kind)) {
    return null;
  }
  const inputs: PlanInputs = {
    passes: [{ kind: pass.kind, expiresAt: pass.expiresAt }],
    subscriptions: [],
    patreon: false,
    ankifyAccess: false,
  };
  const allowance = resolveAllowance(inputs, now);
  if (allowance == null) {
    return null;
  }
  const spendUsd = await readers.passCostSince(
    anonymousPassId,
    allowance.windowStart
  );
  return buildBalance(
    allowance.credits,
    0,
    spendUsd,
    allowance.windowStart,
    allowance.windowEnd,
    allowance.resets
  );
}

// How many AI credits the pass still has to spend right now. Zero for an
// unknown or exhausted pass. The rounded `credits` the account line shows, so
// a preview that reads this and the guard that enforces it always agree.
export async function anonymousPassRemainingCredits(
  anonymousPassId: number,
  now: Date,
  readers: AnonymousPassBalanceReaders
): Promise<number> {
  const balance = await computeAnonymousPassBalance(
    anonymousPassId,
    now,
    readers
  );
  return balance?.credits ?? 0;
}

// Whether the pass can afford `credits` more AI spend. The question an
// anonymous AI preview asks before it offers to run the conversion.
export async function canAnonymousPassSpend(
  anonymousPassId: number,
  credits: number,
  now: Date,
  readers: AnonymousPassBalanceReaders
): Promise<boolean> {
  const remaining = await anonymousPassRemainingCredits(
    anonymousPassId,
    now,
    readers
  );
  return remaining >= credits;
}
