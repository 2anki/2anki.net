// The free AI credits gift, every number in one place. It is paid for from a
// promotional Anthropic credit that lapses on 2026-12-05, so the window closes
// before then and the total is capped: spend past the promotion is billed.

export const AI_GIFT_CREDITS_PER_CLAIM = 100;

// Exposure (credits already spent from gift grants plus unspent credits of
// grants that have not expired) may never pass this. A claim needs room for
// a whole AI_GIFT_CREDITS_PER_CLAIM.
export const AI_GIFT_TOTAL_BUDGET_CREDITS = 11000;

export const AI_GIFT_HOURS = 48;
export const AI_GIFT_DURATION_MS = AI_GIFT_HOURS * 60 * 60 * 1000;

export const AI_GIFT_CLAIMS_CLOSE_AT = new Date('2026-12-04T20:00:00.000Z');
export const AI_GIFT_CREDITS_EXPIRE_BY = new Date('2026-12-04T22:00:00.000Z');

export const AI_GIFT_MAX_CLAIMS_PER_IP = 3;
export const AI_GIFT_IP_WINDOW_MS = 24 * 60 * 60 * 1000;

export function giftClaimsOpen(now: Date): boolean {
  return now.getTime() < AI_GIFT_CLAIMS_CLOSE_AT.getTime();
}

export function giftExpiresAt(claimedAt: Date): Date {
  const natural = claimedAt.getTime() + AI_GIFT_DURATION_MS;
  return new Date(Math.min(natural, AI_GIFT_CREDITS_EXPIRE_BY.getTime()));
}

export function giftBudgetHasRoom(exposureCredits: number): boolean {
  return (
    exposureCredits + AI_GIFT_CREDITS_PER_CLAIM <= AI_GIFT_TOTAL_BUDGET_CREDITS
  );
}
