import {
  computeAiGiftBalance,
  type AiGiftBalanceReaders,
  type AiGiftMode,
} from './giftBalance';

export interface UploadGiftModeDeps extends AiGiftBalanceReaders {
  now: () => Date;
}

// How an upload may use the free AI credits gift. A paying account's upload
// may fall back on it once its plan's credits are spent. An account with no
// plan reaches Claude only while it holds unspent, unexpired gift credits and
// the switch is on; otherwise it converts exactly as a free account does. A
// failed read means no gift, never more AI.
export async function uploadAiGiftMode(
  userId: number | null,
  paying: boolean,
  readers: () => UploadGiftModeDeps
): Promise<AiGiftMode | null> {
  if (userId == null) return null;
  if (paying) return 'fallback';
  try {
    const deps = readers();
    const gift = await computeAiGiftBalance(userId, deps.now(), deps);
    return gift != null && gift.credits > 0 ? 'only' : null;
  } catch (error) {
    console.error('[ai-gift] upload gift read failed', error);
    return null;
  }
}

// A restarted AI job has no plan check of its own. An account with no plan
// that ever claimed the gift restarts on the gift alone, so an expired or
// spent gift stops it instead of letting it run unmetered.
export async function restartAiGiftMode(
  userId: number | null,
  paying: boolean,
  readers: () => UploadGiftModeDeps
): Promise<AiGiftMode | null> {
  if (userId == null) return null;
  if (paying) return 'fallback';
  try {
    return (await readers().findGrant(userId)) == null ? null : 'only';
  } catch (error) {
    console.error('[ai-gift] restart gift read failed', error);
    return 'only';
  }
}
