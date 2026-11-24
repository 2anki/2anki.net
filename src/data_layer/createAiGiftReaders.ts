import type { Knex } from 'knex';
import { getDatabase } from '.';
import { AiCreditGiftsRepository } from './AiCreditGiftsRepository';
import { createAiCreditReaders } from './createAiCreditReaders';
import { getFeatureFlag } from '../lib/featureFlags/getFeatureFlag';
import { AI_CREDITS_GIFT_FLAG } from '../lib/featureFlags/aiCreditsGift';
import { computeAiCreditBalance } from '../lib/claude/aiCredits/balance';
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
  };
}

export function getAiGiftReaders(): UploadGiftModeDeps {
  return createAiGiftReaders(getDatabase());
}
