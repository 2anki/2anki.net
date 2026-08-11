export type SuccessOfferKind = 'anon_signup' | 'upsell';

export interface SuccessOfferContext {
  anonymous: boolean;
  paying: boolean;
}

export function resolveSuccessOffer(
  context: SuccessOfferContext
): SuccessOfferKind | null {
  if (context.anonymous) {
    return 'anon_signup';
  }
  if (context.paying) {
    return null;
  }
  return 'upsell';
}
