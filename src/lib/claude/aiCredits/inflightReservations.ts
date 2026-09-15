// A conservative per-call hold. When a metered Claude call is admitted it
// reserves this many credits until its real cost is recorded; the guard checks
// the recorded balance minus outstanding reservations, so N concurrent chunks
// or pages can no longer all pass on the same pre-call balance. Sized above a
// typical single call so the overshoot the reservations leave uncovered stays
// small, and low enough that a user with real headroom is not throttled.
export const RESERVED_CREDITS_PER_INFLIGHT_CALL = 10;

const reservedByUser = new Map<number, number>();

export function reservedCreditsFor(userId: number): number {
  return reservedByUser.get(userId) ?? 0;
}

export function reserveInflightCredits(userId: number, credits: number): void {
  reservedByUser.set(userId, reservedCreditsFor(userId) + credits);
}

export function releaseInflightCredits(userId: number, credits: number): void {
  const next = reservedCreditsFor(userId) - credits;
  if (next <= 0) {
    reservedByUser.delete(userId);
    return;
  }
  reservedByUser.set(userId, next);
}

export function resetInflightReservations(): void {
  reservedByUser.clear();
}
