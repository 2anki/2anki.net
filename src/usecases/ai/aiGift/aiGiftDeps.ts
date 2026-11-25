import type { Knex } from 'knex';
import type { IAiCreditGiftsRepository } from '../../../data_layer/AiCreditGiftsRepository';
import UsersRepository from '../../../data_layer/UsersRepository';
import { MONTHLY_CARD_LIMIT } from '../../../lib/limits';
import type { AiChoiceHistoryReader } from '../../../lib/upload/claudeCardsDefault';
import type { UploadGiftModeDeps } from '../../../lib/claude/aiCredits/gift/uploadGiftMode';
import type { AiBudgetDeps } from '../../../lib/claude/aiSpendGuard';
import { createAiGiftReaders } from '../../../data_layer/createAiGiftReaders';

export const AI_GIFT_FEEDBACK_EVENT = 'ai_gift_feedback_answered';

export interface ClaudeDefaultStatusReaders extends AiChoiceHistoryReader {
  remainingMonthlyCards(userId: number): Promise<number>;
  storedCardOptions(userId: number): Promise<unknown>;
  giftReaders: () => UploadGiftModeDeps;
  budgetDeps?: AiBudgetDeps;
}

export interface AiGiftDeps {
  gifts: IAiCreditGiftsRepository;
  isEnabled: () => Promise<boolean>;
  exposureCredits: (now: Date) => Promise<number>;
  forgetExposure: () => void;
  networkGrantCount: (ipHash: string, now: Date) => Promise<number>;
  now: () => Date;
  claudeDefault?: ClaudeDefaultStatusReaders;
}

export function createClaudeDefaultStatusReaders(
  database: Knex
): ClaudeDefaultStatusReaders {
  const users = new UsersRepository(database);
  return {
    remainingMonthlyCards: async (userId) => {
      const { cards_used } = await users.getCardUsage(userId);
      return Math.max(0, MONTHLY_CARD_LIMIT - cards_used);
    },
    storedCardOptions: (userId) => users.getCardOptions(userId),
    latestAiToggleEventName: (userId) => users.latestAiToggleEventName(userId),
    giftReaders: () => createAiGiftReaders(database),
  };
}

const EXPOSURE_CACHE_MS = 30_000;

// The present asks for the budget on every page load, signed in or not, so the
// exposure read is cached briefly. A claim never reads it from here: it
// recomputes exposure inside its own locked transaction.
export function cachedExposure(
  read: (now: Date) => Promise<number>,
  clock: () => number = () => Date.now()
): { exposureCredits: (now: Date) => Promise<number>; forget: () => void } {
  let cached: { value: number; until: number } | null = null;
  return {
    exposureCredits: async (now: Date) => {
      if (cached != null && cached.until > clock()) {
        return cached.value;
      }
      const value = await read(now);
      cached = { value, until: clock() + EXPOSURE_CACHE_MS };
      return value;
    },
    forget: () => {
      cached = null;
    },
  };
}

const NETWORK_CACHE_MAX_ENTRIES = 10_000;

// The status read checks the hashed network on signed-out page views too, so
// each network's count is kept briefly. A grant made meanwhile is still
// checked under the lock; the offer may show for up to 30 seconds after a
// network fills, never a grant past the limit.
export function cachedNetworkGrantCount(
  read: (ipHash: string, now: Date) => Promise<number>,
  clock: () => number = () => Date.now()
): (ipHash: string, now: Date) => Promise<number> {
  const counts = new Map<string, { value: number; until: number }>();
  return async (ipHash, now) => {
    const held = counts.get(ipHash);
    if (held != null && held.until > clock()) return held.value;
    const value = await read(ipHash, now);
    if (counts.size >= NETWORK_CACHE_MAX_ENTRIES) counts.clear();
    counts.set(ipHash, { value, until: clock() + EXPOSURE_CACHE_MS });
    return value;
  };
}
