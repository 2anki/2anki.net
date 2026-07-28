import scoreCandidateDeck, {
  DeckScore,
  ScorableCard,
} from '../scoreCandidateDeck';
import { candidateOrderIndex, InducedRule } from './candidateRules';
import { clearsQualityFloor } from './qualityFloor';

export interface Candidate<T extends ScorableCard> {
  rule: InducedRule;
  cards: T[];
  docChars: number;
}

export interface ScoredCandidate<T extends ScorableCard> extends Candidate<T> {
  score: DeckScore;
}

export interface RankResult<T extends ScorableCard> {
  // Best-scoring candidate that clears the quality floor — the deck we ship.
  winner: ScoredCandidate<T> | null;
  // Best-scoring candidate regardless of the floor. Recorded when nothing
  // clears the floor, so a rejected rescue still says which structure came
  // closest rather than vanishing from the corpus.
  best: ScoredCandidate<T> | null;
}

// Produces one candidate deck per rule, drops the rules that yielded nothing,
// and ranks the rest. Both conversion paths share this so their scoring and
// floor semantics stay identical.
export function runInduction<T extends ScorableCard>(
  rules: readonly InducedRule[],
  produceCards: (rule: InducedRule) => T[],
  docChars: number
): RankResult<T> {
  const candidates = rules
    .map((rule) => ({ rule, cards: produceCards(rule), docChars }))
    .filter((candidate) => candidate.cards.length > 0);
  return rankCandidates(candidates);
}

export function rankCandidates<T extends ScorableCard>(
  candidates: Candidate<T>[]
): RankResult<T> {
  const scored: ScoredCandidate<T>[] = candidates.map((candidate) => ({
    ...candidate,
    score: scoreCandidateDeck(candidate.cards, candidate.docChars),
  }));

  const ordered = [...scored].sort((a, b) => {
    if (b.score.score !== a.score.score) {
      return b.score.score - a.score.score;
    }
    return candidateOrderIndex(a.rule) - candidateOrderIndex(b.rule);
  });

  const best = ordered[0] ?? null;
  const winner =
    ordered.find((candidate) =>
      clearsQualityFloor(candidate.cards, candidate.score)
    ) ?? null;

  return { winner, best };
}

export default rankCandidates;
