import type { DeckScore } from '../scoreCandidateDeck';

// The structural shapes a zero-card conversion is re-derived from. Each name is
// recorded verbatim on conversion_rule_scores.rule so a corpus query can say
// which structure rescues which format. 'guess' is the existing plain-text
// heuristic (Q:/A:, term::definition) kept as the final candidate.
export type InducedRule =
  | 'columns'
  | 'heading'
  | 'quote'
  | 'numbered'
  | 'bullets'
  | 'guess';

// Tie-break order, most conservative first: an explicit two-column pairing is
// the least likely to invent a boundary, plain-text guessing the most. When two
// candidates score equally the earlier one wins, so the same input always ships
// the same deck.
export const CANDIDATE_ORDER: readonly InducedRule[] = [
  'columns',
  'heading',
  'quote',
  'numbered',
  'bullets',
  'guess',
];

export function candidateOrderIndex(rule: InducedRule): number {
  const index = CANDIDATE_ORDER.indexOf(rule);
  return index === -1 ? CANDIDATE_ORDER.length : index;
}

// The outcome of an empty-deck rescue attempt. The vocabulary matches the
// reserved values on conversion_rule_scores.outcome so a rescued row reads the
// same whether it came from the Notion or the upload path.
export interface InducedRescue {
  rule: InducedRule;
  outcome: 'rescue_shipped' | 'rescue_rejected';
  // The winning (or best-attempted) candidate's own composite score, so a
  // rejected rescue records the deck it actually judged rather than whatever a
  // later stage shipped or an empty deck. `null` until a candidate was scored.
  score?: DeckScore | null;
}

// A conversion walks several sub-decks; each may run its own rescue. A later
// sub-deck's rejection must never clobber an earlier sub-deck's shipped rescue,
// or the corpus row and the Downloads notice both go missing while the induced
// cards sit in the deck. Shipped is therefore sticky over rejected.
export function mergeInducedRescue(
  current: InducedRescue | undefined,
  next: InducedRescue
): InducedRescue {
  if (
    current?.outcome === 'rescue_shipped' &&
    next.outcome === 'rescue_rejected'
  ) {
    return current;
  }
  return next;
}
