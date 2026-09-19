import { CONVERSION_TRUNCATED_MESSAGE } from '../../infrastracture/adapters/fileConversion/claudeFileConversion';
import { isExpectedClientFault } from '../misc/isExpectedClientFault';
import { isPdfPasswordSentinel } from '../pdf/pdfPasswordSentinel';

// Uploads convert in a worker that serialises an error down to { message, name },
// so these states are matched by name and message and never by instanceof.
const EXPECTED_ERROR_NAMES = new Set([
  'EmptyDeckError',
  'EmptyContentError',
  'PythonZeroCardsError',
  'ClaudeParseError',
  'ClaudeLargeSectionError',
  'ImageOnlyContentError',
  'DeckTooLargeError',
]);

const EXPECTED_MESSAGE_PATTERNS = [
  /^docx_parse_failed/,
  /^pdfinfo_failed/,
  /already an Anki deck/,
];

export function isExpectedUploadState(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return (
    EXPECTED_ERROR_NAMES.has(err.name) ||
    err.message === CONVERSION_TRUNCATED_MESSAGE ||
    isPdfPasswordSentinel(err.message) ||
    EXPECTED_MESSAGE_PATTERNS.some((pattern) => pattern.test(err.message)) ||
    isExpectedClientFault(err)
  );
}
