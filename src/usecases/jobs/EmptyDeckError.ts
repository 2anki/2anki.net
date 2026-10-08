export type EmptyDeckReason =
  | 'no_toggles'
  | 'all_filtered'
  | 'no_content'
  | 'unknown';

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
