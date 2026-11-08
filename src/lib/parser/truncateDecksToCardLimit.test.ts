import { truncateDecksToCardLimit } from './truncateDecksToCardLimit';

function deck(...cards: number[]): { cards: number[] } {
  return { cards };
}

describe('truncateDecksToCardLimit', () => {
  it('keeps cards in document order and drops the overflow across decks', () => {
    const decks = [deck(1, 2, 3), deck(4, 5), deck(6, 7, 8)];

    const result = truncateDecksToCardLimit(decks, 4);

    expect(result).toEqual({ delivered: 4, heldBack: 4, leftOut: 0 });
    expect(decks[0].cards).toEqual([1, 2, 3]);
    expect(decks[1].cards).toEqual([4]);
    expect(decks[2].cards).toEqual([]);
  });

  it('leaves everything intact when the limit exceeds the total', () => {
    const decks = [deck(1, 2), deck(3)];

    const result = truncateDecksToCardLimit(decks, 10);

    expect(result).toEqual({ delivered: 3, heldBack: 0, leftOut: 0 });
    expect(decks[0].cards).toEqual([1, 2]);
    expect(decks[1].cards).toEqual([3]);
  });

  it('drops every card when the limit is zero', () => {
    const decks = [deck(1, 2), deck(3)];

    const result = truncateDecksToCardLimit(decks, 0);

    expect(result).toEqual({ delivered: 0, heldBack: 3, leftOut: 0 });
    expect(decks[0].cards).toEqual([]);
    expect(decks[1].cards).toEqual([]);
  });

  it('truncates exactly at a deck boundary without emptying the next deck early', () => {
    const decks = [deck(1, 2, 3), deck(4, 5, 6)];

    const result = truncateDecksToCardLimit(decks, 3);

    expect(result).toEqual({ delivered: 3, heldBack: 3, leftOut: 0 });
    expect(decks[0].cards).toEqual([1, 2, 3]);
    expect(decks[1].cards).toEqual([]);
  });

  it('floors a negative limit to zero', () => {
    const decks = [deck(1, 2)];

    const result = truncateDecksToCardLimit(decks, -5);

    expect(result).toEqual({ delivered: 0, heldBack: 2, leftOut: 0 });
    expect(decks[0].cards).toEqual([]);
  });

  it('counts only the cut cards the caller says are worth holding back, and the rest as left out', () => {
    const decks = [deck(1, 2, 3), deck(4, 5, 6)];

    const result = truncateDecksToCardLimit(decks, 2, (card) => card % 2 === 0);

    expect(result).toEqual({ delivered: 2, heldBack: 2, leftOut: 2 });
    expect(decks[0].cards).toEqual([1, 2]);
    expect(decks[1].cards).toEqual([]);
  });
});
