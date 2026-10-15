import { CheckoutReceipt } from '../backend/Backend';
import { get2ankiApi } from '../backend/get2ankiApi';
import { CONSENT_CHANGE_EVENT, getEffectiveConsent } from '../consent/consent';
import { firePurchaseConversion, PurchaseConversion } from './googleAds';

const REPORTED_PREFIX = 'ads_purchase_reported:';
const PENDING_PREFIX = 'ads_purchase_pending:';
const MAX_RECEIPT_ATTEMPTS = 3;
const RECEIPT_RETRY_BASE_MS = 300;

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

function persistPending(purchase: PurchaseConversion): void {
  try {
    globalThis.sessionStorage?.setItem(
      `${PENDING_PREFIX}${purchase.sessionId}`,
      JSON.stringify(purchase)
    );
  } catch {
    // Storage blocked: the purchase still lives in memory for this page load.
  }
}

function clearPending(sessionId: string): void {
  try {
    globalThis.sessionStorage?.removeItem(`${PENDING_PREFIX}${sessionId}`);
  } catch {
    // Storage blocked: nothing to clear.
  }
}

function parsePending(raw: string): PurchaseConversion | null {
  try {
    const value = JSON.parse(raw) as Partial<PurchaseConversion>;
    if (
      typeof value.sessionId === 'string' &&
      typeof value.amountCents === 'number' &&
      typeof value.currency === 'string' &&
      typeof value.kind === 'string'
    ) {
      return {
        sessionId: value.sessionId,
        amountCents: value.amountCents,
        currency: value.currency,
        kind: value.kind,
        email: typeof value.email === 'string' ? value.email : null,
      };
    }
  } catch {
    // Corrupt entry: skip it.
  }
  return null;
}

function loadPersistedPending(): PurchaseConversion[] {
  const out: PurchaseConversion[] = [];
  try {
    const store = globalThis.sessionStorage;
    if (store == null) {
      return out;
    }
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key == null || !key.startsWith(PENDING_PREFIX)) {
        continue;
      }
      const raw = store.getItem(key);
      const parsed = raw == null ? null : parsePending(raw);
      if (parsed != null) {
        out.push(parsed);
      }
    }
  } catch {
    return out;
  }
  return out;
}

function fireAwaitingConsent(): void {
  if (getEffectiveConsent() !== 'granted') {
    return;
  }
  for (const [sessionId, purchase] of awaitingConsent) {
    if (firePurchaseConversion(purchase)) {
      markReported(sessionId);
      awaitingConsent.delete(sessionId);
      clearPending(sessionId);
    }
  }
}

function dropAwaitingConsent(): void {
  for (const sessionId of awaitingConsent.keys()) {
    clearPending(sessionId);
  }
  awaitingConsent.clear();
}

function onConsentChange(event: Event): void {
  if ((event as CustomEvent).detail === 'denied') {
    dropAwaitingConsent();
    return;
  }
  fireAwaitingConsent();
}

function ensureConsentListener(): void {
  if (listeningForConsent) {
    return;
  }
  listeningForConsent = true;
  globalThis.addEventListener?.(CONSENT_CHANGE_EVENT, onConsentChange);
}

/**
 * An EEA buyer often answers the banner only after Stripe has sent them back,
 * by which time the page has stripped the session id from the URL. The receipt
 * is kept in memory and in sessionStorage, so a reload before the choice does
 * not lose it, and it is sent the moment consent is granted.
 */
function holdUntilConsent(purchase: PurchaseConversion): void {
  awaitingConsent.set(purchase.sessionId, purchase);
  persistPending(purchase);
  ensureConsentListener();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout?.(resolve, ms);
  });
}

async function fetchReceiptWithRetry(
  sessionId: string
): Promise<CheckoutReceipt | null> {
  for (let attempt = 1; attempt <= MAX_RECEIPT_ATTEMPTS; attempt += 1) {
    const result = await get2ankiApi().getCheckoutReceipt(sessionId);
    if (result.status === 'ok') {
      return result.receipt;
    }
    if (result.status === 'not_found') {
      return null;
    }
    if (attempt < MAX_RECEIPT_ATTEMPTS) {
      await delay(RECEIPT_RETRY_BASE_MS * attempt);
    }
  }
  return null;
}

/**
 * Looks any persisted held purchase back up after a reload and either sends it
 * now (consent already granted) or re-arms it to fire on the next grant. The
 * pages Stripe returns buyers to call this on mount, so a reload before the
 * banner choice no longer drops the conversion.
 */
export function replayPendingPurchaseConversions(): void {
  for (const purchase of loadPersistedPending()) {
    if (alreadyReported(purchase.sessionId)) {
      clearPending(purchase.sessionId);
      continue;
    }
    awaitingConsent.set(purchase.sessionId, purchase);
  }
  if (awaitingConsent.size === 0) {
    return;
  }
  ensureConsentListener();
  fireAwaitingConsent();
}

/**
 * Called by the pages Stripe sends buyers back to. Looks the session up
 * server-side (amount, currency, kind), retrying a transient lookup failure,
 * and reports the purchase to Google Ads. A purchase that cannot be sent yet
 * (consent not granted) is held and survives a reload. The email is attached
 * only to a receipt the signed-in user owns.
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
    const receipt = await fetchReceiptWithRetry(sessionId);
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
      clearPending(sessionId);
    } else {
      holdUntilConsent(purchase);
    }
  } finally {
    inFlight.delete(sessionId);
  }
}
