import { get2ankiApi } from '../backend/get2ankiApi';
import { firePurchaseConversion } from './googleAds';

const REQUESTED_PREFIX = 'ads_receipt_requested:';

function alreadyRequested(sessionId: string): boolean {
  try {
    const key = `${REQUESTED_PREFIX}${sessionId}`;
    if (globalThis.sessionStorage?.getItem(key) != null) {
      return true;
    }
    globalThis.sessionStorage?.setItem(key, '1');
    return false;
  } catch {
    return false;
  }
}

/**
 * Called by the pages Stripe sends buyers back to. Looks the session up
 * server-side (amount, currency, kind) and reports the purchase to Google
 * Ads. Safe to call more than once for the same session.
 */
export async function reportPurchaseConversion(
  sessionId: string,
  email?: string | null
): Promise<void> {
  if (alreadyRequested(sessionId)) {
    return;
  }
  const receipt = await get2ankiApi().getCheckoutReceipt(sessionId);
  if (receipt == null) {
    return;
  }
  firePurchaseConversion({
    sessionId,
    amountCents: receipt.amount,
    currency: receipt.currency,
    kind: receipt.kind,
    email,
  });
}
