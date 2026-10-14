import { getEffectiveConsent } from '../consent/consent';

// Public identifiers of the 2anki Google Ads account. They appear in page
// source on every site that runs the tag, so there is nothing to hide.
export const GOOGLE_ADS_ID = 'AW-18513857875';
export const PURCHASE_CONVERSION_LABEL = 'vNO7CM7xgZ0dENOajPxE';
// Created in the Ads UI after the purchase action; empty means "do not fire".
export const SIGNUP_CONVERSION_LABEL = '';

const FIRED_PREFIX = 'ads_purchase_fired:';

interface GtagWindow {
  gtag?: (...args: unknown[]) => void;
  sessionStorage?: Storage;
}

export interface PurchaseConversion {
  sessionId: string;
  amountCents: number;
  currency: string;
  kind: string;
  email?: string | null;
}

function alreadyFired(sessionId: string): boolean {
  try {
    return (
      (globalThis as GtagWindow).sessionStorage?.getItem(
        `${FIRED_PREFIX}${sessionId}`
      ) != null
    );
  } catch {
    return false;
  }
}

function markFired(sessionId: string): void {
  try {
    (globalThis as GtagWindow).sessionStorage?.setItem(
      `${FIRED_PREFIX}${sessionId}`,
      '1'
    );
  } catch {
    // Storage blocked: the dedupe is best effort, GA4 and Ads dedupe on
    // transaction_id anyway.
  }
}

/**
 * Reports one purchase to Google Ads (and the GA4 client stream) once per
 * Checkout Session, only when the visitor allowed marketing cookies. Returns
 * whether anything was sent.
 */
export function firePurchaseConversion(purchase: PurchaseConversion): boolean {
  const w = globalThis as GtagWindow;
  if (w.gtag == null || getEffectiveConsent() !== 'granted') {
    return false;
  }
  if (alreadyFired(purchase.sessionId)) {
    return false;
  }
  const value = purchase.amountCents / 100;
  if (purchase.email != null && purchase.email !== '') {
    w.gtag('set', 'user_data', { email: purchase.email });
  }
  w.gtag('event', 'conversion', {
    send_to: `${GOOGLE_ADS_ID}/${PURCHASE_CONVERSION_LABEL}`,
    value,
    currency: purchase.currency,
    transaction_id: purchase.sessionId,
  });
  w.gtag('event', 'purchase', {
    transaction_id: purchase.sessionId,
    value,
    currency: purchase.currency,
    items: [{ item_name: purchase.kind, price: value, quantity: 1 }],
  });
  markFired(purchase.sessionId);
  return true;
}

export function fireSignupConversion(): boolean {
  const w = globalThis as GtagWindow;
  if (
    w.gtag == null ||
    SIGNUP_CONVERSION_LABEL === '' ||
    getEffectiveConsent() !== 'granted'
  ) {
    return false;
  }
  w.gtag('event', 'conversion', {
    send_to: `${GOOGLE_ADS_ID}/${SIGNUP_CONVERSION_LABEL}`,
  });
  return true;
}
