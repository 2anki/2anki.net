// Set when a visitor leaves the AI preview for checkout, so the return says an
// AI deck is being built only to the visitor who asked for one. It lives in
// sessionStorage so it ends with the tab and never outlives one purchase.
const KEY = '2anki-ai-preview-checkout';

export function markAiPreviewCheckout(): void {
  try {
    globalThis.sessionStorage?.setItem(KEY, '1');
  } catch {
    // The return still resumes; it shows the neutral status line instead.
  }
}

export function aiPreviewCheckoutMarked(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function clearAiPreviewCheckout(): void {
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
