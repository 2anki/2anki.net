import { createHash } from 'node:crypto';

import { getFeatureFlag } from '../featureFlags/getFeatureFlag';
import { LIMIT_WALL_PASS_FIRST_FLAG } from '../featureFlags/limitWallPassFirst';

export const ANONYMOUS_PREVIEW_CARDS_FLAG = 'anonymous_preview_cards';

export type PreviewCardsArm = 'off' | 'control' | 'treatment';

// Under the pass-first wall a free account releases only the first cards, so
// handing them over beside the hold would give away what sign-up offers.
export async function isPreviewCardsTestLive(): Promise<boolean> {
  try {
    const [previewOn, passFirstOn] = await Promise.all([
      getFeatureFlag(ANONYMOUS_PREVIEW_CARDS_FLAG, false),
      getFeatureFlag(LIMIT_WALL_PASS_FIRST_FLAG, false),
    ]);
    return previewOn && !passFirstOn;
  } catch {
    return false;
  }
}

// The salt keeps this split independent of the September partial-delivery
// split, which hashed the bare anon id.
export function resolvePreviewCardsArm(
  anonId: string | null,
  testLive: boolean
): PreviewCardsArm {
  if (!testLive || anonId == null || anonId === '') {
    return 'off';
  }
  const digest = createHash('sha256')
    .update(`preview-cards:${anonId}`)
    .digest();
  return digest[0] % 2 === 0 ? 'treatment' : 'control';
}
