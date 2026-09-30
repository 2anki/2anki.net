export type SuccessOfferKind = 'anon_signup';

export interface SuccessOfferContext {
  anonymous: boolean;
}

// Only anonymous visitors get an offer after a download. The logged-in free
// upsell was removed: over ninety days it was shown 1,921 times and produced
// no purchase at all, while a third of the people who saw it dismissed it.
export function resolveSuccessOffer(
  context: SuccessOfferContext
): SuccessOfferKind | null {
  return context.anonymous ? 'anon_signup' : null;
}
