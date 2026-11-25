// The sign-up origin the upload card's inline form reports. The email route
// reports it from the form; a Google, Notion, Microsoft or Apple sign-up
// finishes on /upload after leaving the page, so the card leaves it in this
// tab's session storage and the upload page's sign-up event reads it once.
export const GIFT_SIGNUP_ORIGIN = 'upload_card_ai';

const ORIGIN_KEY = '2anki-ai-gift-signup-origin';

function session(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function rememberGiftSignupOrigin(): void {
  session()?.setItem(ORIGIN_KEY, GIFT_SIGNUP_ORIGIN);
}

export function takeGiftSignupOrigin(): string | null {
  const tab = session();
  const origin = tab?.getItem(ORIGIN_KEY) ?? null;
  tab?.removeItem(ORIGIN_KEY);
  return origin === GIFT_SIGNUP_ORIGIN ? origin : null;
}
