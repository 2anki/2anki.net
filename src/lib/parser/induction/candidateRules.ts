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
