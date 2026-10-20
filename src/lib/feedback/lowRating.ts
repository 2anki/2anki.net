export const LOW_RATING_MAX = 2;

export const isLowRating = (rating: number): boolean =>
  Number.isInteger(rating) && rating <= LOW_RATING_MAX;

const REPLY_TO_MAX_LENGTH = 254;
const SINGLE_ADDRESS = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export const isSafeReplyTo = (email: string): boolean =>
  email.length <= REPLY_TO_MAX_LENGTH &&
  !/[\r\n]/.test(email) &&
  SINGLE_ADDRESS.test(email);

// Stored feedback pages that are not themselves an in-app path but still
// warrant a follow-up email. The value is the in-app path the email links to.
// A Map (not an object literal) so a client-supplied key like 'toString'
// cannot escape the allowlist through the prototype chain.
const FEEDBACK_PAGE_LINKS = new Map<string, string>([
  ['downloads/deck_done', '/downloads'],
]);

// Resolves the in-app path a low-rating email should link to, or null when the
// page is not one we will follow up on. In-app paths pass through; every other
// value must be on the explicit allowlist, never accepted for its own sake.
export const resolveFeedbackLink = (page: string): string | null => {
  if (page.startsWith('/')) {
    return page;
  }
  return FEEDBACK_PAGE_LINKS.get(page) ?? null;
};
