import {
  ClaudeLargeSectionError,
  ClaudeParseError,
  ClaudeRefusalError,
  ClaudeTruncatedError,
  EmptyContentError,
  ImageOnlyContentError,
} from './ClaudeService';

// Why Claude made no cards from one file of several. Only failures that belong
// to that file: an outage or a credit stop is about the whole upload.
export type AiFileFailureReason =
  | 'declined'
  | 'too_large'
  | 'no_text'
  | 'unreadable';

export function aiFileFailureReason(
  error: unknown
): AiFileFailureReason | null {
  if (error instanceof ClaudeRefusalError) return 'declined';
  if (error instanceof ClaudeLargeSectionError) return 'too_large';
  if (
    error instanceof EmptyContentError ||
    error instanceof ImageOnlyContentError
  ) {
    return 'no_text';
  }
  if (
    error instanceof ClaudeParseError ||
    error instanceof ClaudeTruncatedError
  ) {
    return 'unreadable';
  }
  return null;
}

const WARNING_PREFIX = 'ai-file-failed:';
const REASONS: ReadonlySet<string> = new Set([
  'declined',
  'too_large',
  'no_text',
  'unreadable',
]);

export function isAiFileFailedWarning(warning: string): boolean {
  return warning.startsWith(WARNING_PREFIX);
}

export function aiFileFailedWarning(
  fileName: string,
  reason: AiFileFailureReason
): string {
  return `${WARNING_PREFIX}${reason}:${fileName}`;
}

const WHY: Record<AiFileFailureReason, string> = {
  declined:
    'Claude declined it, so reword or remove the part it would not answer',
  too_large: 'a section was too large, so split it and upload it again',
  no_text: 'Claude found no text to make cards from',
  unreadable: "Claude's answer could not be read, so upload it again",
};

// A header line stays short however many files a zip skipped.
const LISTED_FILES = 3;

function baseName(fileName: string): string {
  const normalized = fileName.replaceAll('\\', '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function aiFileFailedWarningText(warnings: string[]): string | null {
  const failures = warnings.flatMap((warning) => {
    if (!warning.startsWith(WARNING_PREFIX)) return [];
    const rest = warning.slice(WARNING_PREFIX.length);
    const separator = rest.indexOf(':');
    const reason = rest.slice(0, separator);
    if (separator < 0 || !REASONS.has(reason)) return [];
    return [
      {
        name: baseName(rest.slice(separator + 1)),
        why: WHY[reason as AiFileFailureReason],
      },
    ];
  });
  if (failures.length === 0) return null;
  if (failures.length === 1) {
    const [only] = failures;
    return `No cards from ${only.name}: ${only.why}. The other files are in your deck.`;
  }
  const listed = failures
    .slice(0, LISTED_FILES)
    .map((f) => `${f.name} (${f.why})`)
    .join(', ');
  const more =
    failures.length > LISTED_FILES
      ? ` and ${failures.length - LISTED_FILES} more`
      : '';
  return `No cards from ${failures.length} files: ${listed}${more}. The other files are in your deck.`;
}
