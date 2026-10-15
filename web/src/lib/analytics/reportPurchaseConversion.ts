import { CheckoutReceipt } from '../backend/Backend';
import { get2ankiApi } from '../backend/get2ankiApi';
import {
  CONSENT_CHANGE_EVENT,
  getEffectiveConsent,
  readStoredConsent,
} from '../consent/consent';
import { firePurchaseConversion, PurchaseConversion } from './googleAds';

const REPORTED_PREFIX = 'ads_purchase_reported:';
const PENDING_PREFIX = 'ads_purchase_pending:';
const MAX_RECEIPT_ATTEMPTS = 3;
const RECEIPT_RETRY_BASE_MS = 300;

/** The signed-in user a return page knows about, if any. */
export interface PurchaseBuyer {
  id: number;
  email?: string | null;
}

/**
 * What survives a reload. The buyer email is deliberately not stored: nothing
 * about the visitor is written to the browser before consent, only the id of
 * the account that owned the receipt, so the replay re-attaches an email only
 * when that same account is still signed in.
 */
interface PendingPurchase {
  sessionId: string;
  amountCents: number;
  currency: string;
  kind: string;
  ownerId: number | null;
}

const inFlight = new Set<string>();
const reportedThisLoad = new Set<string>();
const awaitingConsent = new Map<string, PurchaseConversion>();
let listeningForConsent = false;

function alreadyReported(sessionId: string): boolean {
  if (reportedThisLoad.has(sessionId)) {
    return true;
  }
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
  reportedThisLoad.add(sessionId);
  try {
    globalThis.sessionStorage?.setItem(`${REPORTED_PREFIX}${sessionId}`, '1');
  } catch {
    // Storage blocked: Ads and GA4 still dedupe on transaction_id.
  }
}

function persistPending(
  purchase: PurchaseConversion,
  ownerId: number | null
): void {
  const pending: PendingPurchase = {
    sessionId: purchase.sessionId,
    amountCents: purchase.amountCents,
    currency: purchase.currency,
    kind: purchase.kind,
    ownerId,
  };
  try {
    globalThis.sessionStorage?.setItem(
      `${PENDING_PREFIX}${purchase.sessionId}`,
      JSON.stringify(pending)
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

function parsePending(raw: string): PendingPurchase | null {
  try {
    const value = JSON.parse(raw) as Partial<PendingPurchase>;
    if (
      typeof value.sessionId === 'string' &&
      Number.isSafeInteger(value.amountCents) &&
      (value.amountCents as number) >= 0 &&
      typeof value.currency === 'string' &&
      typeof value.kind === 'string'
    ) {
      return {
        sessionId: value.sessionId,
        amountCents: value.amountCents as number,
        currency: value.currency,
        kind: value.kind,
        ownerId: Number.isSafeInteger(value.ownerId)
          ? (value.ownerId as number)
          : null,
      };
    }
  } catch {
    // Corrupt entry: skip it.
  }
  return null;
}

function loadPersistedPending(): PendingPurchase[] {
  const out: PendingPurchase[] = [];
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
  for (const pending of loadPersistedPending()) {
    clearPending(pending.sessionId);
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
 * is kept in memory and (without the email) in sessionStorage, so a reload
 * before the choice does not lose it, and it is sent the moment consent is
 * granted.
 */
function holdUntilConsent(
  purchase: PurchaseConversion,
  ownerId: number | null
): void {
  awaitingConsent.set(purchase.sessionId, purchase);
  persistPending(purchase, ownerId);
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
 * pages Stripe returns buyers to call this on mount, once the signed-in user
 * is known, so a reload before the banner choice no longer drops the
 * conversion. The email is re-attached only when the account that bought is
 * the one signed in now. An explicit "denied" clears the persisted entries.
 */
export function replayPendingPurchaseConversions(
  buyer?: PurchaseBuyer | null
): void {
  const persisted = loadPersistedPending();
  if (readStoredConsent() === 'denied') {
    for (const pending of persisted) {
      clearPending(pending.sessionId);
    }
    return;
  }
  for (const pending of persisted) {
    if (alreadyReported(pending.sessionId)) {
      clearPending(pending.sessionId);
      continue;
    }
    awaitingConsent.set(pending.sessionId, {
      sessionId: pending.sessionId,
      amountCents: pending.amountCents,
      currency: pending.currency,
      kind: pending.kind,
      email:
        pending.ownerId != null && buyer?.id === pending.ownerId
          ? (buyer.email ?? null)
          : null,
    });
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
  buyer?: PurchaseBuyer | null
): Promise<void> {
  if (alreadyReported(sessionId) || inFlight.has(sessionId)) {
    return;
  }
  inFlight.add(sessionId);
  try {
    const receipt = await fetchReceiptWithRetry(sessionId);
    if (
      receipt == null ||
      alreadyReported(sessionId) ||
      readStoredConsent() === 'denied'
    ) {
      return;
    }
    const owner = receipt.anonymous ? null : (buyer ?? null);
    const purchase: PurchaseConversion = {
      sessionId,
      amountCents: receipt.amount,
      currency: receipt.currency,
      kind: receipt.kind,
      email: owner?.email ?? null,
    };
    if (firePurchaseConversion(purchase)) {
      markReported(sessionId);
      awaitingConsent.delete(sessionId);
      clearPending(sessionId);
    } else {
      holdUntilConsent(purchase, owner?.id ?? null);
    }
  } finally {
    inFlight.delete(sessionId);
  }
}
