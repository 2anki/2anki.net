export const ANONYMOUS_PARTIAL_DELIVERY_FLAG = 'anonymous_partial_delivery';

export type PartialDeliveryArm = 'off' | 'control' | 'treatment';

/**
 * The v2 split (#4590) ended on 2026-10-19 with treatment ahead on signup
 * starts, 60.0% against 46.5% over about 600 cap-hitters per arm, so every
 * visitor with an anonymous id now gets the held deck. Without an id there is
 * nothing to hold the deck under, so that request keeps the limit wall.
 */
export function resolveAnonymousPartialArm(
  anonymousId: string | null,
  flagEnabled: boolean
): PartialDeliveryArm {
  if (!flagEnabled) {
    return 'off';
  }
  if (anonymousId == null || anonymousId === '') {
    return 'control';
  }
  return 'treatment';
}
