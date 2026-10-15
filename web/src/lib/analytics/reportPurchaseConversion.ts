import { get2ankiApi } from '../backend/get2ankiApi';
import { CONSENT_CHANGE_EVENT } from '../consent/consent';
import { firePurchaseConversion, PurchaseConversion } from './googleAds';

const REPORTED_PREFIX = 'ads_purchase_reported:';
const inFlight = new Set<string>();
const awaitingConsent = new Map<string, PurchaseConversion>();
let listeningForConsent = false;

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

function flushAwaitingConsent(event: Event): void {
  if ((event as CustomEvent).detail !== 'granted') {
    return;
  }
  for (const [sessionId, purchase] of awaitingConsent) {
    if (firePurchaseConversion(purchase)) {
      markReported(sessionId);
      awaitingConsent.delete(sessionId);
    }
  }
}

/**
 * An EEA buyer often answers the banner only after Stripe has sent them back,
 * by which time the page has stripped the session id from the URL. The
 * receipt is kept in memory and sent the moment consent is granted.
 */
function holdUntilConsent(purchase: PurchaseConversion): void {
  awaitingConsent.set(purchase.sessionId, purchase);
  if (listeningForConsent) {
    return;
  }
  listeningForConsent = true;
  globalThis.addEventListener?.(CONSENT_CHANGE_EVENT, flushAwaitingConsent);
}

/**
 * Called by the pages Stripe sends buyers back to. Looks the session up
 * server-side (amount, currency, kind) and reports the purchase to Google
 * Ads. Marks the session only once something was actually sent; a purchase
 * that could not be sent yet (consent not granted) waits for the next grant
 * in this page session. The email is attached only to a receipt the
 * signed-in user owns.
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
    const purchase: PurchaseConversion = {
      sessionId,
      amountCents: receipt.amount,
      currency: receipt.currency,
      kind: receipt.kind,
      email: receipt.anonymous ? null : email,
    };
    if (firePurchaseConversion(purchase)) {
      markReported(sessionId);
      awaitingConsent.delete(sessionId);
    } else {
      holdUntilConsent(purchase);
    }
  } finally {
    inFlight.delete(sessionId);
  }
}
