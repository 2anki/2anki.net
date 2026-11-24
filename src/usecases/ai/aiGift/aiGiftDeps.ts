import type { IAiCreditGiftsRepository } from '../../../data_layer/AiCreditGiftsRepository';

export const AI_GIFT_FEEDBACK_EVENT = 'ai_gift_feedback_answered';

export interface AiGiftDeps {
  gifts: IAiCreditGiftsRepository;
  isEnabled: () => Promise<boolean>;
  exposureCredits: (now: Date) => Promise<number>;
  forgetExposure: () => void;
  now: () => Date;
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
