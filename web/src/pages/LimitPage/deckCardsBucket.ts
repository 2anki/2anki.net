import { ANONYMOUS_CARD_CAP, FREE_MONTHLY_CARDS } from './LimitWall';

export type DeckCardsBucket =
  | 'within_anonymous_cap'
  | 'within_free_month'
  | 'over_free_month';

export function deckCardsBucket(totalCards: number): DeckCardsBucket {
  if (totalCards <= ANONYMOUS_CARD_CAP) return 'within_anonymous_cap';
  if (totalCards <= FREE_MONTHLY_CARDS) return 'within_free_month';
  return 'over_free_month';
}
