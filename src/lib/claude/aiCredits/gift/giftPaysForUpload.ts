import { giftMarkerHeld } from './giftConversionMarker';
import { AI_GIFT_MIN_MONTHLY_CARDS } from './giftTerms';
import { uploadAiGiftMode, type UploadGiftModeDeps } from './uploadGiftMode';

export interface GiftPaysForUploadDeps {
  gift: () => UploadGiftModeDeps;
  remainingMonthlyCards: (userId: number) => Promise<number>;
}

// Whether an account with no plan would convert this upload on the gift: an
// unexpired gift with credits, the month's card minimum left and no other gift
// conversion running. The same three things that let a gift-only upload with
// Claude on reach Claude, so the default is never applied to an upload that
// would then be refused or built without AI.
export async function giftWouldPayForUpload(
  userId: number,
  deps: GiftPaysForUploadDeps
): Promise<boolean> {
  if (giftMarkerHeld(userId, deps.gift().now().getTime())) return false;
  if ((await uploadAiGiftMode(userId, false, deps.gift)) !== 'only') {
    return false;
  }
  return (
    (await deps.remainingMonthlyCards(userId)) >= AI_GIFT_MIN_MONTHLY_CARDS
  );
}
