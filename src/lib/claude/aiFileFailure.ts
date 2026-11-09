import {
  ClaudeLargeSectionError,
  ClaudeParseError,
  ClaudeRefusalError,
  ClaudeTruncatedError,
  EMPTY_CONTENT_UPLOAD_MESSAGE,
  EmptyContentError,
  ImageOnlyContentError,
} from './ClaudeService';
import {
  AI_FILE_FAILURE_REASONS as REASONS,
  type AiFileFailure,
  type AiFileFailureReason,
} from './aiFileFailureReasons';

export type { AiFileFailureReason } from './aiFileFailureReasons';

export function aiFileFailureReason(
  error: unknown
): AiFileFailureReason | null {
  const fromChunks = (error as { chunkFileFailure?: AiFileFailureReason })
    ?.chunkFileFailure;
  if (fromChunks != null && REASONS.has(fromChunks)) return fromChunks;
  if (error instanceof ClaudeRefusalError) return 'declined';
  // The scanned-PDF path says this when no page gave cards and also when no
  // page image could be read, which is ours to fix, not the file's.
  if (
    error instanceof EmptyContentError &&
    error.message === EMPTY_CONTENT_UPLOAD_MESSAGE
  ) {
    return null;
  }
  if (error instanceof ClaudeLargeSectionError) return 'too_large';
  if (
    error instanceof EmptyContentError ||
    error instanceof ImageOnlyContentError
  ) {
    return 'no_text';
  }
  if (error instanceof ClaudeTruncatedError) return 'too_large';
  if (error instanceof ClaudeParseError) return 'unreadable';
  return null;
}

const WARNING_PREFIX = 'ai-file-failed:';

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
  no_text:
    'Claude found no text to make cards from, so check the file has text in it',
  unreadable: "Claude's answer could not be read, so upload it again",
};

// A header line stays short however many files a zip skipped.
const LISTED_FILES = 3;

const CONVERTED_TO_HTML = /\.(pdf|docx?|pptx?|xlsx?|md|txt)\.html$/i;
const NOTION_PAGE_ID = / [0-9a-f]{32}(?=\.[a-z0-9]+$)/i;

// The name the user uploaded: a zip's PDF converts as `week 3.pdf.html`, and a
// Notion export page carries its 32-character id before the extension.
function displayName(fileName: string): string {
  const normalized = fileName.replaceAll('\\', '/');
  return normalized
    .slice(normalized.lastIndexOf('/') + 1)
    .replace(CONVERTED_TO_HTML, '.$1')
    .replace(NOTION_PAGE_ID, '');
}

// The files a run left out, by the name the user uploaded, in upload order.
export function aiFileFailures(warnings: string[]): AiFileFailure[] {
  return warnings.flatMap((warning) => {
    if (!warning.startsWith(WARNING_PREFIX)) return [];
    const rest = warning.slice(WARNING_PREFIX.length);
    const separator = rest.indexOf(':');
    const reason = rest.slice(0, separator);
    if (separator < 0 || !REASONS.has(reason)) return [];
    return [
      {
        name: displayName(rest.slice(separator + 1)),
        reason: reason as AiFileFailureReason,
      },
    ];
  });
}

export function aiFileFailedWarningText(warnings: string[]): string | null {
  const failures = aiFileFailures(warnings).map(({ name, reason }) => ({
    name,
    why: WHY[reason],
  }));
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
