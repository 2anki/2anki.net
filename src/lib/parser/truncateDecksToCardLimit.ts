export interface DeckCardTruncation {
  delivered: number;
  heldBack: number;
}

export function truncateDecksToCardLimit<T>(
  decks: { cards: T[] }[],
  limit: number,
  isWorthHolding: (card: T) => boolean = () => true
): DeckCardTruncation {
  const cap = Math.max(0, Math.floor(limit));
  let delivered = 0;
  let heldBack = 0;

  for (const deck of decks) {
    const remaining = Math.max(0, cap - delivered);
    if (deck.cards.length > remaining) {
      heldBack += deck.cards.slice(remaining).filter(isWorthHolding).length;
      deck.cards = deck.cards.slice(0, remaining);
    }
    delivered += deck.cards.length;
  }

  return { delivered, heldBack };
}
