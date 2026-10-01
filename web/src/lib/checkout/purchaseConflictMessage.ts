import type { TFunction } from 'i18next';
import type { CheckoutConflict, PurchaseBlockCode } from './checkoutConflict';

const DATED_CODES: ReadonlySet<PurchaseBlockCode> = new Set([
  'pass_still_active',
  'already_unlimited',
]);

function formatExpiry(expiresAt: string, language?: string): string | null {
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleDateString(language, {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function purchaseConflictMessage(
  t: TFunction,
  conflict: Pick<CheckoutConflict, 'code' | 'expiresAt'>,
  language?: string
): string {
  const expiry =
    conflict.expiresAt != null
      ? formatExpiry(conflict.expiresAt, language)
      : null;
  if (expiry != null && DATED_CODES.has(conflict.code)) {
    return t(`common:checkout.conflict.${conflict.code}_until`, {
      date: expiry,
    });
  }
  return t(`common:checkout.conflict.${conflict.code}`);
}
