import type { TFunction } from 'i18next';
import type { CheckoutConflict, PurchaseBlockCode } from './checkoutConflict';
import { formatPassEnd } from './formatPassEnd';

const DATED_CODES: ReadonlySet<PurchaseBlockCode> = new Set([
  'pass_still_active',
  'already_unlimited',
]);

export function purchaseConflictMessage(
  t: TFunction,
  conflict: Pick<CheckoutConflict, 'code' | 'expiresAt'>,
  language?: string
): string {
  const expiry =
    conflict.expiresAt != null
      ? formatPassEnd(conflict.expiresAt, language)
      : null;
  if (expiry != null && DATED_CODES.has(conflict.code)) {
    return t(`common:checkout.conflict.${conflict.code}_until`, {
      date: expiry,
    });
  }
  return t(`common:checkout.conflict.${conflict.code}`);
}
