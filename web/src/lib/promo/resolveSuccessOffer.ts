export type SuccessOfferKind = 'anon_signup' | 'confirm_email';

export interface SuccessOfferContext {
  anonymous: boolean;
  emailVerified?: boolean;
}

// The success state renders at most one offer. An anonymous visitor is asked to
// create an account; a signed-in user whose email is still unverified is asked
// to confirm it. Anonymity wins — a guest has no email to confirm.
export function resolveSuccessOffer(
  context: SuccessOfferContext
): SuccessOfferKind | null {
  if (context.anonymous) return 'anon_signup';
  if (context.emailVerified === false) return 'confirm_email';
  return null;
}
