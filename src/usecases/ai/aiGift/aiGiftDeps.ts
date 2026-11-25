import type { Knex } from 'knex';
import type { IAiCreditGiftsRepository } from '../../../data_layer/AiCreditGiftsRepository';
import UsersRepository from '../../../data_layer/UsersRepository';
import { MONTHLY_CARD_LIMIT } from '../../../lib/limits';
import type { AiChoiceHistoryReader } from '../../../lib/upload/claudeCardsDefault';

export const AI_GIFT_FEEDBACK_EVENT = 'ai_gift_feedback_answered';

export interface ClaudeDefaultStatusReaders extends AiChoiceHistoryReader {
  remainingMonthlyCards(userId: number): Promise<number>;
  storedCardOptions(userId: number): Promise<unknown>;
}

export interface AiGiftDeps {
  gifts: IAiCreditGiftsRepository;
  isEnabled: () => Promise<boolean>;
  exposureCredits: (now: Date) => Promise<number>;
  forgetExposure: () => void;
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
