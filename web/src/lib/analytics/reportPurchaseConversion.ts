import { get2ankiApi } from '../backend/get2ankiApi';
import { firePurchaseConversion } from './googleAds';

const REPORTED_PREFIX = 'ads_purchase_reported:';
const inFlight = new Set<string>();

function alreadyReported(sessionId: string): boolean {
  try {
    return (
      globalThis.sessionStorage?.getItem(`${REPORTED_PREFIX}${sessionId}`) !=
      null
    );
  } catch {
    return false;
  }
}

function markReported(sessionId: string): void {
  try {
    globalThis.sessionStorage?.setItem(`${REPORTED_PREFIX}${sessionId}`, '1');
  } catch {
    // Storage blocked: Ads and GA4 still dedupe on transaction_id.
  }
}

/**
 * Called by the pages Stripe sends buyers back to. Looks the session up
 * server-side (amount, currency, kind) and reports the purchase to Google
 * Ads. Marks the session only once something was actually sent, so a failed
 * lookup or a not-yet-granted consent can be retried later in the session.
 * The email is attached only to a receipt the signed-in user owns.
 */
export async function reportPurchaseConversion(
  sessionId: string,
  email?: string | null
): Promise<void> {
  if (alreadyReported(sessionId) || inFlight.has(sessionId)) {
    return;
  }
  inFlight.add(sessionId);
  try {
    const receipt = await get2ankiApi().getCheckoutReceipt(sessionId);
    if (receipt == null) {
      return;
    }
    const sent = firePurchaseConversion({
      sessionId,
      amountCents: receipt.amount,
      currency: receipt.currency,
      kind: receipt.kind,
      email: receipt.anonymous ? null : email,
    });
    if (sent) {
      markReported(sessionId);
    }
  } finally {
    inFlight.delete(sessionId);
  }
}
