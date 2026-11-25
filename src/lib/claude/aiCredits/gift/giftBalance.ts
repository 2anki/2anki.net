import { CREDIT_UNIT_USD } from '../balance';

// How a metered call may use gift credits. 'fallback': a paying account's
// upload conversion, on the gift only once the plan's credits are spent.
// 'only': an account with no plan whose upload reached Claude because of the
// gift, so the gift is the only thing it may spend. Absent: no gift at all
// (chat, note types, photos, tagging and every other surface).
export type AiGiftMode = 'fallback' | 'only';

export interface AiGiftGrant {
  id: number;
  userId: number;
  credits: number;
  claimedAt: Date;
  expiresAt: Date;
  firstUsedAt?: Date | null;
  feedbackAnsweredAt?: Date | null;
}

export interface AiGiftBalance {
  giftId: number;
  credits: number;
  rawCredits: number;
  spent: number;
  claimedAt: Date;
  expiresAt: Date;
  firstUsedAt: Date | null;
}

export interface AiGiftBalanceReaders {
  isEnabled(): Promise<boolean>;
  findGrant(userId: number): Promise<AiGiftGrant | null>;
  giftCostSince(giftId: number, userId: number, since: Date): Promise<number>;
}

export function giftIsActive(grant: AiGiftGrant, now: Date): boolean {
  return (
    grant.claimedAt.getTime() <= now.getTime() &&
    now.getTime() < grant.expiresAt.getTime()
  );
}

export function buildGiftBalance(
  grant: AiGiftGrant,
  spendUsd: number
): AiGiftBalance {
  const spentCredits = spendUsd / CREDIT_UNIT_USD;
  const rawCredits = grant.credits - spentCredits;
  return {
    giftId: grant.id,
    credits: Math.max(0, Math.round(rawCredits)),
    rawCredits,
    spent: Math.max(0, Math.round(spentCredits)),
    claimedAt: grant.claimedAt,
    expiresAt: grant.expiresAt,
    firstUsedAt: grant.firstUsedAt ?? null,
  };
}

// The gift's own balance over its own [claimedAt, expiresAt) window, the way a
// pass row carries its credits over [expiresAt - duration, expiresAt). Spend
// is what the usage ledger recorded against this grant id; a plan allowance
// never sees it and it never sees the plan's spend. Null when the switch is
// off, there is no grant, or the grant's window does not contain now.
export async function computeAiGiftBalance(
  userId: number,
  now: Date,
  readers: AiGiftBalanceReaders
): Promise<AiGiftBalance | null> {
  if (!(await readers.isEnabled())) {
    return null;
  }
  const grant = await readers.findGrant(userId);
  if (grant == null || !giftIsActive(grant, now)) {
    return null;
  }
  const spendUsd = await readers.giftCostSince(
    grant.id,
    userId,
    grant.claimedAt
  );
  return buildGiftBalance(grant, spendUsd);
}
