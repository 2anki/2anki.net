import { createHash } from 'node:crypto';

export const ANONYMOUS_PARTIAL_DELIVERY_FLAG = 'anonymous_partial_delivery';

export type PartialDeliveryArm = 'off' | 'control' | 'treatment';

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
  const digest = createHash('sha256').update(anonymousId).digest();
  return digest[0] % 2 === 0 ? 'treatment' : 'control';
}
