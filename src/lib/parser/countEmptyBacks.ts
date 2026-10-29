import { hasVisibleContent } from './hasVisibleContent';

const isBlank = (value: string | null | undefined): boolean =>
  value == null || value.trim().length === 0;

export function countEmptyBacks<T>(
  cards: readonly T[],
  getBack: (card: T) => string | null | undefined,
  getFront: (card: T) => string | null | undefined,
  isCountable: (card: T) => boolean = () => true
): number {
  let count = 0;
  for (const card of cards) {
    if (
      isCountable(card) &&
      !hasVisibleContent(getBack(card)) &&
      !isBlank(getFront(card))
    ) {
      count += 1;
    }
  }
  return count;
}

export default countEmptyBacks;
