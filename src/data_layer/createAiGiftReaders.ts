import type { Knex } from 'knex';
import { getDatabase } from '.';
import { AiCreditGiftsRepository } from './AiCreditGiftsRepository';
import { createAiCreditReaders } from './createAiCreditReaders';
import { getFeatureFlag } from '../lib/featureFlags/getFeatureFlag';
import { AI_CREDITS_GIFT_FLAG } from '../lib/featureFlags/aiCreditsGift';
import { computeAiCreditBalance } from '../lib/claude/aiCredits/balance';
import {
  AI_GIFT_CREDITS_EXPIRE_BY,
  AI_GIFT_CREDITS_PER_CLAIM,
  giftBudgetHasRoom,
  giftClaimsOpen,
} from '../lib/claude/aiCredits/gift/giftTerms';
import type { UploadGiftModeDeps } from '../lib/claude/aiCredits/gift/uploadGiftMode';

export function createAiGiftReaders(db: Knex): UploadGiftModeDeps {
  const gifts = new AiCreditGiftsRepository(db);
  const plans = createAiCreditReaders(db);
  return {
    isEnabled: () => getFeatureFlag(AI_CREDITS_GIFT_FLAG, false),
    findGrant: (userId) => gifts.findGrant(userId),
    giftCostSince: (giftId, userId, since) =>
      gifts.giftCostSince(giftId, userId, since),
    now: () => new Date(),
    // The same boundary the spend guard uses: a plan is spent when its rounded
    // balance is at zero. No plan at all is not "spent": that account is not
    // paying through a plan, and the guard fails open for it.
    planSpent: async (userId) => {
      const balance = await computeAiCreditBalance(userId, new Date(), plans);
      return balance != null && balance.credits <= 0;
    },
    mayStartGrant: async (now) =>
      giftClaimsOpen(now) &&
      giftBudgetHasRoom(await gifts.exposureCredits(now)),
    // A grant made before its first AI call runs until the gift's end; its
    // first call moves the end to seven days later, never past the gift's.
    startGrant: async (userId, ipHash, now) => {
      if (!giftClaimsOpen(now)) return null;
      const outcome = await gifts.startGrant({
        userId,
        credits: AI_GIFT_CREDITS_PER_CLAIM,
        startedAt: now,
        expiresAt: AI_GIFT_CREDITS_EXPIRE_BY,
        ipHash,
      });
      return outcome.ok
        ? { grant: outcome.grant, created: outcome.created }
        : null;
    },
  };
}

export function getAiGiftReaders(): UploadGiftModeDeps {
  return createAiGiftReaders(getDatabase());
}

export function markAiGiftFirstUse(
  db: Knex,
  giftId: number,
  at: Date,
  expiresAt: Date
): Promise<boolean> {
  return new AiCreditGiftsRepository(db).markFirstUse(giftId, at, expiresAt);
}
