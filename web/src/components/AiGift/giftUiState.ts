const DISMISSED_KEY = '2anki-ai-gift-dismissed';
const CLAIM_INTENT_KEY = '2anki-ai-gift-claim-intent';
const CLAIM_INTENT_MAX_AGE_MS = 60 * 60 * 1000;

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

export function takeClaimIntent(now: number): boolean {
  const store = storage();
  const saved = store?.getItem(CLAIM_INTENT_KEY);
  if (store == null || saved == null) return false;
  store.removeItem(CLAIM_INTENT_KEY);
  const savedAt = Number(saved);
  return Number.isFinite(savedAt) && now - savedAt < CLAIM_INTENT_MAX_AGE_MS;
}
