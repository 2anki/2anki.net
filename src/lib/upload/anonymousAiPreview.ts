import { getFeatureFlag } from '../featureFlags/getFeatureFlag';

export const ANONYMOUS_AI_PREVIEW_FLAG = 'anonymous_ai_preview';

// Gates the no-account AI preview: a visitor without an account who turns on AI
// gets a small, cost-capped sample of the cards Claude would write, then the
// choice to unlock the full deck with a Day Pass or continue without AI. Off by
// default; the unset state is exactly today's behaviour (the free parser deck).
export function anonymousAiPreviewEnabled(): Promise<boolean> {
  return getFeatureFlag(ANONYMOUS_AI_PREVIEW_FLAG, false);
}

// The source file is held for the resume under an anon_id namespaced like the
// plan-hold key, so a preview hold is never matched by the sign-up claim lookup
// (which reads the bare anon_id) and vice versa.
const PREVIEW_HOLD_PREFIX = 'preview:';

export function previewHoldKey(anonId: string): string {
  return `${PREVIEW_HOLD_PREFIX}${anonId}`;
}

export function isPreviewHoldKey(anonId: string): boolean {
  return anonId.startsWith(PREVIEW_HOLD_PREFIX);
}
