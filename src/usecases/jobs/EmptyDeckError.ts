export type EmptyDeckReason =
  | 'no_toggles'
  | 'all_filtered'
  | 'no_content'
  | 'unknown';

const EMPTY_DECK_REASON_SPECIFICITY: Record<EmptyDeckReason, number> = {
  all_filtered: 3,
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

  constructor(sourceFormat?: 'markdown', reason: EmptyDeckReason = 'unknown') {
    super('No cards found in your upload. Use .zip, .html, .md, or .csv.');
    this.name = 'EmptyDeckError';
    this.sourceFormat = sourceFormat;
    this.reason = reason;
  }
}
