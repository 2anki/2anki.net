// A free person who taps "Get every card" leaves for the Day Pass checkout. The
// file itself waits in the pending-upload store; this marker says the return
// from checkout should send it again with AI on, without another tap. It lives
// in sessionStorage so it ends with the tab and never outlives one purchase.
const KEY = '2anki-thin-deck-resume';

export const THIN_DECK_RESUME_WAIT_MS = 30_000;
export const THIN_DECK_RESUME_POLL_MS = 2_000;

export function markThinDeckResume(): void {
  try {
    globalThis.sessionStorage?.setItem(KEY, '1');
  } catch {
    // The offer still works; the person gets the one-tap Continue banner.
  }
}

export function thinDeckResumeMarked(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function clearThinDeckResume(): void {
  try {
    globalThis.sessionStorage?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
