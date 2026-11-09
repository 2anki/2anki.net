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
// Postgres jsonb rejects \u0000, and a control character has no place in a
// file name shown on My decks.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
// Half of a surrogate pair, left by a cut or a malformed name. Postgres jsonb
// rejects it as an escape too.
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// What `uploads.skipped_ai_files` holds: names cleaned and cut to the length
// the reader accepts, so a file is never stored and then hidden.
export function storableAiFileFailures(
  failures: AiFileFailure[]
): AiFileFailure[] {
  return failures.flatMap(({ name, reason }) => {
    const cleaned = name
      .replaceAll(CONTROL_CHARACTERS, '')
      .slice(0, MAX_STORED_NAME_LENGTH)
      .replaceAll(LONE_SURROGATE, '');
    return cleaned.length === 0 ? [] : [{ name: cleaned, reason }];
  });
}

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
