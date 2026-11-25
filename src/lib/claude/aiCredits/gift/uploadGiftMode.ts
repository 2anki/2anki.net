import {
  buildGiftBalance,
  computeAiGiftBalance,
  giftIsActive,
  type AiGiftBalanceReaders,
  type AiGiftGrant,
  type AiGiftMode,
} from './giftBalance';

export interface UploadGiftModeDeps extends AiGiftBalanceReaders {
  now: () => Date;
  planSpent: (userId: number) => Promise<boolean>;
  // Whether a new grant could be made now: claims open and the total has
  // room for a whole grant. The grant itself is made by startGrant, under
  // the lock, which checks both again with the per-network limit.
  mayStartGrant: (now: Date) => Promise<boolean>;
  startGrant: (
    userId: number,
    ipHash: string | null,
    now: Date
  ) => Promise<{ grant: AiGiftGrant; created: boolean } | null>;
}

// 'spent': an account with no plan whose unexpired gift has no credits left.
// Its upload builds with the standard parser and carries the credits notice.
// 'start': an account with no plan and no grant yet, while the gift could
// make one; its first upload the gift pays for makes the grant.
export type UploadGift = AiGiftMode | 'spent' | 'start';

// A paying account draws on the gift only when it holds gift credits and its
// plan has no recorded balance left. The gift is read first, so an account
// without one never pays for the plan read. A plan with balance leaves the
// conversion exactly as it was before the gift existed.
async function paidAccountMayUseGift(
  userId: number,
  deps: UploadGiftModeDeps
): Promise<boolean> {
  const gift = await computeAiGiftBalance(userId, deps.now(), deps);
  if (gift == null || gift.credits <= 0) return false;
  return deps.planSpent(userId);
}

// An account with no plan: its grant's balance, or, with no grant at all, a
// grant it could start. An account whose grant expired never gets another.
async function noPlanGift(
  userId: number,
  deps: UploadGiftModeDeps
): Promise<UploadGift | null> {
  if (!(await deps.isEnabled())) return null;
  const now = deps.now();
  const grant = await deps.findGrant(userId);
  if (grant == null) {
    return (await deps.mayStartGrant(now)) ? 'start' : null;
  }
  if (!giftIsActive(grant, now)) return null;
  const spendUsd = await deps.giftCostSince(grant.id, userId, grant.claimedAt);
  return buildGiftBalance(grant, spendUsd).credits > 0 ? 'only' : 'spent';
}

// How an upload may use the free AI credits gift. A paying account's upload
// may draw on it once its plan's credits are spent. An account with no plan
// reaches Claude only while it holds unspent, unexpired gift credits, or has
// no grant yet while the gift can still make one, and the switch is on;
// otherwise it converts exactly as a free account does. A failed read means
// no gift, never more AI.
export async function uploadAiGiftMode(
  userId: number | null,
  paying: boolean,
  readers: () => UploadGiftModeDeps
): Promise<UploadGift | null> {
  if (userId == null) return null;
  try {
    const deps = readers();
    if (paying) {
      return (await paidAccountMayUseGift(userId, deps)) ? 'fallback' : null;
    }
    return await noPlanGift(userId, deps);
  } catch (error) {
    console.error('[ai-gift] upload gift read failed', error);
    return null;
  }
}

// 'off': an account with no plan that claimed while the switch is off. It
// restarts on the gift alone, which the spend guard then refuses, and it takes
// no marker, since nothing can draw on the gift.
export type RestartGift = AiGiftMode | 'off';

// A restarted AI job has no plan check of its own. An account with no plan
// that ever claimed the gift restarts on the gift alone, so an expired or
// spent gift stops it instead of letting it run unmetered. A paying account
// restarts on the gift only when its plan is spent and the gift has credits.
export async function restartAiGiftMode(
  userId: number | null,
  paying: boolean,
  readers: () => UploadGiftModeDeps
): Promise<RestartGift | null> {
  if (userId == null) return null;
  if (paying) {
    try {
      return (await paidAccountMayUseGift(userId, readers()))
        ? 'fallback'
        : null;
    } catch (error) {
      console.error('[ai-gift] restart gift read failed', error);
      return null;
    }
  }
  try {
    const deps = readers();
    if ((await deps.findGrant(userId)) == null) return null;
    return (await deps.isEnabled()) ? 'only' : 'off';
  } catch (error) {
    console.error('[ai-gift] restart gift read failed', error);
    return 'only';
  }
}
