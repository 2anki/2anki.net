export interface DeckCardTruncation {
  delivered: number;
  heldBack: number;
  // Cut cards that were not worth holding (no answer): left out of the deck.
  leftOut: number;
}

export function truncateDecksToCardLimit<T>(
  decks: { cards: T[] }[],
  limit: number,
  isWorthHolding: (card: T) => boolean = () => true
): DeckCardTruncation {
  const cap = Math.max(0, Math.floor(limit));
  let delivered = 0;
  let heldBack = 0;
  let leftOut = 0;

  for (const deck of decks) {
    const remaining = Math.max(0, cap - delivered);
    if (deck.cards.length > remaining) {
      const cut = deck.cards.slice(remaining);
      const worthHolding = cut.filter(isWorthHolding).length;
      heldBack += worthHolding;
      leftOut += cut.length - worthHolding;
      deck.cards = deck.cards.slice(0, remaining);
    }
    delivered += deck.cards.length;
  }

  return { delivered, heldBack, leftOut };
}
