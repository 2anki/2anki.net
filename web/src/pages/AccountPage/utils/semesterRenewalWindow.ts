const DAY_MS = 24 * 60 * 60 * 1000;

export const SEMESTER_RENEWAL_WINDOW_MS = 7 * DAY_MS;

type PassKind = '24h' | '7d' | '120d' | 'unlimited';

export function semesterRenewalDaysLeft(
  passKind: PassKind | null | undefined,
  passExpiresAt: string | null | undefined,
  now: Date
): number | null {
  if (passKind !== '120d' || passExpiresAt == null) {
    return null;
  }
  const remainingMs = new Date(passExpiresAt).getTime() - now.getTime();
  if (
    Number.isNaN(remainingMs) ||
    remainingMs <= 0 ||
    remainingMs > SEMESTER_RENEWAL_WINDOW_MS
  ) {
    return null;
  }
  return Math.ceil(remainingMs / DAY_MS);
}
