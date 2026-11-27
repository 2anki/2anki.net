import {
  AI_GIFT_CLAUDE_CARDS_PER_JOB,
  createGiftCardAllowance,
  keepWithinGiftCardLimit,
} from './giftCardAllowance';
import { MONTHLY_CARD_LIMIT } from '../../../../usecases/users/CheckMonthlyCardLimitUseCase';

function deckOf(cards: number, name = 'Deck') {
  return {
    name,
    cards: Array.from({ length: cards }, (_, i) => `${name} ${i}`),
  };
}

describe('the Claude card allowance of one gift-paid job', () => {
  it('is the free monthly card limit', () => {
    expect(AI_GIFT_CLAUDE_CARDS_PER_JOB).toBe(MONTHLY_CARD_LIMIT);
    expect(createGiftCardAllowance()).toEqual({ remaining: 100 });
  });

  it('is shared by every file of the job, so later files get what earlier ones left', () => {
    const giftCardAllowance = createGiftCardAllowance();
    const delivered = Array.from(
      { length: 6 },
      () =>
        keepWithinGiftCardLimit([deckOf(20)], {
          aiGift: 'only',
          giftCardAllowance,
        }).decks.flatMap((deck) => deck.cards).length
    );

    expect(delivered).toEqual([20, 20, 20, 20, 20, 0]);
    expect(giftCardAllowance.remaining).toBe(0);
  });

  it('cuts a file front to back at what is left and counts the cards held back', () => {
    const giftCardAllowance = { remaining: 25 };

    const kept = keepWithinGiftCardLimit([deckOf(15, 'A'), deckOf(15, 'B')], {
      aiGift: 'only',
      giftCardAllowance,
    });

    expect(kept.decks.map((deck) => deck.cards.length)).toEqual([15, 10]);
    expect(kept.heldBack).toBe(5);
    expect(giftCardAllowance.remaining).toBe(0);
  });

  it.each([
    ['a paying account drawing on the gift', 'fallback' as const],
    ['an upload the gift does not pay for', null],
  ])('leaves %s untouched', (_label, aiGift) => {
    const giftCardAllowance = { remaining: 1 };

    const kept = keepWithinGiftCardLimit([deckOf(5)], {
      aiGift,
      giftCardAllowance,
    });

    expect(kept).toEqual({ decks: [deckOf(5)], heldBack: 0 });
    expect(giftCardAllowance.remaining).toBe(1);
  });
});
