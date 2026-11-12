export type SuccessOfferKind = 'anon_signup';

export interface SuccessOfferContext {
  anonymous: boolean;
}

export function resolveSuccessOffer(
  context: SuccessOfferContext
): SuccessOfferKind | null {
  if (context.anonymous) return 'anon_signup';
  return null;
}
