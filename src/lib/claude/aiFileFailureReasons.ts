// Why Claude made no cards from one file of several. Only failures that belong
// to that file: an outage or a credit stop is about the whole upload.
export type AiFileFailureReason =
  | 'declined'
  | 'too_large'
  | 'no_text'
  | 'unreadable';

export const AI_FILE_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'declined',
  'too_large',
  'no_text',
  'unreadable',
]);

export interface AiFileFailure {
  name: string;
  reason: AiFileFailureReason;
}

const MAX_STORED_NAME_LENGTH = 255;

function isAiFileFailure(value: unknown): value is AiFileFailure {
  if (value == null || typeof value !== 'object') return false;
  const { name, reason } = value as Record<string, unknown>;
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MAX_STORED_NAME_LENGTH &&
    typeof reason === 'string' &&
    AI_FILE_FAILURE_REASONS.has(reason)
  );
}

// `uploads.skipped_ai_files` as stored: Postgres hands back the parsed jsonb,
// sqlite the JSON text. Anything that is not a list of named failures reads as
// none, so a bad row never breaks My decks.
export function parseStoredAiFileFailures(value: unknown): AiFileFailure[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(isAiFileFailure)
    .map(({ name, reason }) => ({ name, reason }));
}
