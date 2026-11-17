// The source file is held for the resume under an anon_id namespaced like the
// plan-hold key. The sign-up claim/peek lookup and the hold-write paths reject
// any cookie carrying this prefix (see ClaimHeldDeckUseCase.holdKeys and
// UploadService), so a preview hold and a sign-up hold can never cross
// namespaces and a crafted cookie cannot reach another flow's holds.
const PREVIEW_HOLD_PREFIX = 'preview:';

export function previewHoldKey(anonId: string): string {
  return `${PREVIEW_HOLD_PREFIX}${anonId}`;
}

export function isPreviewHoldKey(anonId: string): boolean {
  return anonId.startsWith(PREVIEW_HOLD_PREFIX);
}
