import { track } from '../../services/events/track';

export type SigninSurface =
  | 'google'
  | 'microsoft'
  | 'apple'
  | 'notion'
  | 'magic_link'
  | 'magic_link_reset';

type AccountAge = 'under_1h' | '1h_to_30d' | 'over_30d' | 'unknown';

const HOUR_MS = 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * HOUR_MS;

export function accountAgeBucket(
  createdAt: Date | string | null | undefined,
  now: Date = new Date()
): AccountAge {
  if (createdAt == null) return 'unknown';
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return 'unknown';
  const ageMs = now.getTime() - createdMs;
  if (ageMs < HOUR_MS) return 'under_1h';
  if (ageMs < THIRTY_DAYS_MS) return '1h_to_30d';
  return 'over_30d';
}

// Measurement only: sizes how often a provider- or link-proven sign-in lands
// on an account whose email was never verified, before any enforcement.
export function recordUnverifiedSignin(
  user: {
    id: number | string;
    email_verified?: boolean | null;
    created_at?: Date | string | null;
  },
  surface: SigninSurface,
  now: Date = new Date()
): void {
  if (user.email_verified === true) return;
  track('unverified_account_signin', {
    userId: Number(user.id),
    props: { surface, account_age: accountAgeBucket(user.created_at, now) },
  });
}
