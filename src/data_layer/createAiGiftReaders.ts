import type { Knex } from 'knex';
import { getDatabase } from '.';
import { AiCreditGiftsRepository } from './AiCreditGiftsRepository';
import { getFeatureFlag } from '../lib/featureFlags/getFeatureFlag';
import { AI_CREDITS_GIFT_FLAG } from '../lib/featureFlags/aiCreditsGift';
import type { UploadGiftModeDeps } from '../lib/claude/aiCredits/gift/uploadGiftMode';

export function createAiGiftReaders(db: Knex): UploadGiftModeDeps {
  const gifts = new AiCreditGiftsRepository(db);
  return {
    isEnabled: () => getFeatureFlag(AI_CREDITS_GIFT_FLAG, false),
    findGrant: (userId) => gifts.findGrant(userId),
    giftCostSince: (giftId, userId, since) =>
      gifts.giftCostSince(giftId, userId, since),
    now: () => new Date(),
  };
}

export function getAiGiftReaders(): UploadGiftModeDeps {
  return createAiGiftReaders(getDatabase());
}
