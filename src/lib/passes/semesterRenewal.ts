import type { PassKind } from '../../data_layer/UserPassRepository';

export const SEMESTER_RENEWAL_WINDOW_HOURS = 7 * 24;
export const SEMESTER_RENEWAL_WINDOW_MS =
  SEMESTER_RENEWAL_WINDOW_HOURS * 60 * 60 * 1000;

export function isInSemesterRenewalWindow(
  kind: PassKind | null,
  expiresAt: Date | null,
  now: Date
): boolean {
  if (kind !== '120d' || expiresAt == null) {
    return false;
  }
  const remainingMs = expiresAt.getTime() - now.getTime();
  return remainingMs > 0 && remainingMs <= SEMESTER_RENEWAL_WINDOW_MS;
}
