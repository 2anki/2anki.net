// A free person who taps "Get every card" leaves for the Day Pass checkout. The
// file itself waits in the pending-upload store; this marker says the return
// from checkout should send it again with AI on, without another tap. It lives
// in sessionStorage so it ends with the tab and never outlives one purchase.
const KEY = '2anki-thin-deck-resume';

export const THIN_DECK_RESUME_WAIT_MS = 30_000;
export const THIN_DECK_RESUME_POLL_MS = 2_000;

// A marker older than this is a leftover from an abandoned checkout.
export const THIN_DECK_RESUME_MAX_AGE_MS = 30 * 60 * 1000;

export function markThinDeckResume(now: number = Date.now()): void {
  try {
    globalThis.sessionStorage?.setItem(KEY, String(now));
  } catch {
    // The offer still works; the person gets the one-tap Continue banner.
  }
}

export function thinDeckResumeMarked(now: number = Date.now()): boolean {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    const markedAt = raw == null ? Number.NaN : Number(raw);
    if (!Number.isFinite(markedAt)) {
      return false;
    }
    if (now - markedAt > THIN_DECK_RESUME_MAX_AGE_MS) {
      clearThinDeckResume();
      return false;
    }
    return true;
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
