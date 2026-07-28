import { detectOverSplit } from '../detectOverSplit';
import type { DeckScore, ScorableCard } from '../scoreCandidateDeck';

// A rescued deck ships only when it clears every one of these. Failing honest
// below the floor is deliberate: a student who trusts a bad rescued deck is
// worse off than one told plainly that no structure was found. The thresholds
// are named constants, never env flags, because deterministic output for a
// given input is a parser contract. They are provisional pending corpus
// calibration (#3882) — tighten from measured percentiles, not judgement.
export const FLOOR_MIN_CARDS = 3;
export const FLOOR_MAX_EMPTY_BACK_RATE = 0.2;
export const FLOOR_MAX_DUPLICATE_FRONT_RATE = 0.5;

export function clearsQualityFloor(
  cards: readonly ScorableCard[],
  score: DeckScore
): boolean {
  if (score.cardCount < FLOOR_MIN_CARDS) {
    return false;
  }
  if (detectOverSplit(cards.map((card) => card.name))) {
    return false;
  }
  // Read the blank-back rate off the score, which measures VISIBLE length
  // (markup stripped) and exempts cloze cards. A raw string check would pass a
  // deck whose every back is a `<br>` spacer — the exact class both inducers
  // let through to the floor, since they already reject raw-blank backs at
  // construction.
  if (score.blankBackRate > FLOOR_MAX_EMPTY_BACK_RATE) {
    return false;
  }
  if (score.duplicateFrontRate > FLOOR_MAX_DUPLICATE_FRONT_RATE) {
    return false;
  }
  return true;
}
