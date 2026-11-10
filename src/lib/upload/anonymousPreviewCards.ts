import { createHash } from 'node:crypto';

export const ANONYMOUS_PREVIEW_CARDS_FLAG = 'anonymous_preview_cards';

export type PreviewCardsArm = 'off' | 'control' | 'treatment';

// A held deck in the treatment arm also hands over the capped deck that was
// already built. The salt keeps this split independent of the September
// partial-delivery split, which hashed the bare anon id.
export function resolvePreviewCardsArm(
  anonId: string | null,
  flagOn: boolean
): PreviewCardsArm {
  if (!flagOn || anonId == null || anonId === '') {
    return 'off';
  }
  const digest = createHash('sha256')
    .update(`preview-cards:${anonId}`)
    .digest();
  return digest[0] % 2 === 0 ? 'treatment' : 'control';
}
