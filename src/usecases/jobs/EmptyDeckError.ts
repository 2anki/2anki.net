import type { RescueCandidate } from '../../types/RescueCandidate';

export type EmptyDeckReason =
  | 'no_toggles'
  | 'empty_answers'
  | 'all_filtered'
  | 'no_content'
  | 'unknown';

const EMPTY_DECK_REASON_SPECIFICITY: Record<EmptyDeckReason, number> = {
  all_filtered: 4,
  empty_answers: 3,
  no_toggles: 2,
  no_content: 1,
  unknown: 0,
};

// A multi-file upload that ends empty holds one reason per file; the user needs
// the most actionable one. A card filter that wiped the deck outranks text with
// no structure, which outranks an empty file, which outranks unknown.
export function mostSpecificEmptyReason(
  reasons: Iterable<EmptyDeckReason>
): EmptyDeckReason {
  let best: EmptyDeckReason = 'unknown';
  for (const reason of reasons) {
    if (
      EMPTY_DECK_REASON_SPECIFICITY[reason] >
      EMPTY_DECK_REASON_SPECIFICITY[best]
    ) {
      best = reason;
    }
  }
  return best;
}

export class EmptyDeckError extends Error {
  readonly sourceFormat: 'markdown' | undefined;

  readonly reason: EmptyDeckReason;

  // Structures that made cards but missed the quality floor; the empty-deck
  // response offers them so the user can choose one.
  readonly rescueCandidates: RescueCandidate[];

  constructor(
    sourceFormat?: 'markdown',
    reason: EmptyDeckReason = 'unknown',
    rescueCandidates: RescueCandidate[] = []
  ) {
    super('No cards found in your upload. Use .zip, .html, .md, or .csv.');
    this.name = 'EmptyDeckError';
    this.sourceFormat = sourceFormat;
    this.reason = reason;
    this.rescueCandidates = rescueCandidates;
  }
}
