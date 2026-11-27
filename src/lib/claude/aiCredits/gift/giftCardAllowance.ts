import type { AiGiftMode } from './giftBalance';
import { MONTHLY_CARD_LIMIT } from '../../../../usecases/users/CheckMonthlyCardLimitUseCase';

// The Claude cards one gift-paid job may deliver in total, across every file
// it holds, zips and restarts included. These cards are delivered even past
// the month's free cards, so this is what bounds how far one job goes over.
export const AI_GIFT_CLAUDE_CARDS_PER_JOB = MONTHLY_CARD_LIMIT;

export interface GiftCardAllowance {
  remaining: number;
}

export function createGiftCardAllowance(): GiftCardAllowance {
  return { remaining: AI_GIFT_CLAUDE_CARDS_PER_JOB };
}

export interface GiftCardLimits {
  aiGift?: AiGiftMode | null;
  giftCardAllowance?: GiftCardAllowance;
}

// A gift-only job's Claude cards stay within what is left of the job's
// allowance, which each file's cards then use up. Cards past it are dropped
// front to back and counted, the way the parser holds cards back for a free
// account.
export function keepWithinGiftCardLimit<D extends { cards: unknown[] }>(
  decks: D[],
  limits: GiftCardLimits
): { decks: D[]; heldBack: number } {
  const allowance = limits.giftCardAllowance;
  if (limits.aiGift !== 'only' || allowance == null) {
    return { decks, heldBack: 0 };
  }
  let heldBack = 0;
  const kept: D[] = [];
  for (const deck of decks) {
    const cards = deck.cards.slice(0, Math.max(0, allowance.remaining));
    heldBack += deck.cards.length - cards.length;
    allowance.remaining -= cards.length;
    if (cards.length > 0) {
      kept.push({ ...deck, cards });
    }
  }
  if (heldBack > 0) {
    console.info('[ai-gift] gift deck kept within its card allowance', {
      allowance: AI_GIFT_CLAUDE_CARDS_PER_JOB,
      heldBack,
    });
  }
  return { decks: kept, heldBack };
}
