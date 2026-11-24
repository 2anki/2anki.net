const DISMISSED_KEY = '2anki-ai-gift-dismissed';
const CLAIM_INTENT_KEY = '2anki-ai-gift-claim-intent';
const CLAIM_INTENT_MAX_AGE_MS = 60 * 60 * 1000;
const OPENED_BEFORE_KEY = '2anki-ai-gift-opened-before';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isGiftDismissed(): boolean {
  return storage()?.getItem(DISMISSED_KEY) === '1';
}

export function setGiftDismissed(dismissed: boolean): void {
  const store = storage();
  if (store == null) return;
  if (dismissed) {
    store.setItem(DISMISSED_KEY, '1');
  } else {
    store.removeItem(DISMISSED_KEY);
  }
}

export function rememberClaimIntent(now: number): void {
  storage()?.setItem(CLAIM_INTENT_KEY, String(now));
}

export function hasClaimIntent(now: number): boolean {
  const saved = storage()?.getItem(CLAIM_INTENT_KEY);
  if (saved == null) return false;
  const savedAt = Number(saved);
  return Number.isFinite(savedAt) && now - savedAt < CLAIM_INTENT_MAX_AGE_MS;
}

export function forgetClaimIntent(): void {
  storage()?.removeItem(CLAIM_INTENT_KEY);
}

let openedButNotStored = false;

export function hasGiftOpenedBefore(): boolean {
  if (openedButNotStored) return true;
  try {
    const store = storage();
    return store == null || store.getItem(OPENED_BEFORE_KEY) === '1';
  } catch {
    return true;
  }
}

export function rememberGiftOpened(): void {
  try {
    storage()?.setItem(OPENED_BEFORE_KEY, '1');
  } catch {
    openedButNotStored = true;
  }
}

const CHECKOUT_RETURN_PARAMS = [
  'checkout',
  'session_id',
  'credits',
  'pass_session',
];

export function isCheckoutReturn(search: string): boolean {
  const params = new URLSearchParams(search);
  return CHECKOUT_RETURN_PARAMS.some((name) => params.has(name));
}

const landedOnCheckoutReturn = isCheckoutReturn(
  globalThis.location?.search ?? ''
);

export function pageLoadedFromCheckout(): boolean {
  return landedOnCheckoutReturn;
}
