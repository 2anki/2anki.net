import { APIResponseError, APIErrorCode } from '@notionhq/client';
import { PythonExitError } from '../../lib/anki/buildPythonExitError';
import {
  ClaudeLargeSectionError,
  EmptyContentError,
} from '../../lib/claude/ClaudeService';
import {
  CONVERSION_TRUNCATED_MESSAGE,
  FileConversionError,
} from '../../infrastracture/adapters/fileConversion/claudeFileConversion';
import { EmptyDeckError } from './EmptyDeckError';
import { inferColumnMapping } from '../../lib/notionDatabase/inferColumnMapping';
import { isPdfPasswordSentinel } from '../../lib/pdf/pdfPasswordSentinel';
import { isNotionDatabaseNotPageError } from '../../services/NotionService/helpers/isNotionDatabaseNotPageError';
import { isConversionChildCrashedError } from '../../lib/workerTermination';

export const NOTION_DATABASE_NOT_PAGE_REASON =
  'This Notion link points to a database. We read the database rows as cards — share the database with the 2anki integration in Notion, then convert again.';

export const NOTION_TOKEN_EXPIRED_REASON = 'notion_token_expired';

export const CONVERSION_PROCESS_CRASHED_REASON =
  'This conversion stopped unexpectedly — the process was restarted before it finished. Convert again, and if the file is very large, split it into smaller parts first.';

export const EMPTY_DECK_FAILURE_REASON =
  "No cards in this deck yet. 2anki makes a card from every Notion toggle — the toggle title becomes the question, what's inside becomes the answer. Wrap your key terms in toggles, then convert again.";

export const MARKDOWN_LIKELY_LOSSY_REASON =
  'Notion Markdown exports flatten toggles — re-export this page as HTML and the toggles become flashcards.';

export const DOCX_UNREADABLE_REASON =
  "We couldn't read this .docx. It may have been renamed from another format. Try re-exporting it from Word or Google Docs.";

export const CLAUDE_PARSE_FAILED_REASON =
  "Claude's answer couldn't be turned into cards this time. Convert again, or try a smaller part of the file.";

export const DECK_TOO_LARGE_REASON =
  'This deck is too large to build as one file. Split the source and convert each part separately.';

export const COLUMNS_AMBIGUOUS_PREFIX = 'COLUMNS_AMBIGUOUS:';

export function isColumnsAmbiguousError(
  error: unknown
): error is Error & { code: string; columns: string[] } {
  return (
    error instanceof Error &&
    (error as Error & { code?: string }).code ===
      'NOTION_DATABASE_COLUMNS_AMBIGUOUS' &&
    Array.isArray((error as Error & { columns?: unknown }).columns)
  );
}

function buildColumnsAmbiguousReason(columns: string[]): string {
  const inferred = inferColumnMapping(columns);
  const payload = {
    columns,
    suggested: {
      frontField: inferred.frontField,
      backField: inferred.backField,
    },
  };
  return `${COLUMNS_AMBIGUOUS_PREFIX}${JSON.stringify(payload)}`;
}

export function isNotionUnauthorizedError(error: unknown): boolean {
  return (
    error instanceof APIResponseError &&
    error.code === APIErrorCode.Unauthorized
  );
}

function genericFailureReason(jobId = 'unavailable'): string {
  return `Something went wrong on our end converting this file. Job ID ${jobId}. Check status at 2anki.net/status — if everything's green, email support@2anki.net with the job ID.`;
}

function hasCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error && (error as Error & { code?: string }).code === code
  );
}

// The upload worker serialises errors across a thread boundary as
// { message, name }, and GeneratePackagesUseCase rebuilds a plain Error from
// that. Every instanceof below therefore fails on the async upload path, so the
// classes whose message is meant to reach the user are matched by the name that
// survived instead.
function hasName(error: unknown, name: string): boolean {
  return error instanceof Error && error.name === name;
}

const isDocxParseError = (error: unknown): error is Error =>
  error instanceof Error && error.message.startsWith('docx_parse_failed');

// EpubWalker throws EpubNoAnnotationsError; the Kindle clippings path throws a
// plain Error with the same sentence shape. Both messages are already the copy.
const isNoHighlightsError = (error: unknown): error is Error =>
  error instanceof Error &&
  (error.name === 'EpubNoAnnotationsError' ||
    /no highlighted passages/.test(error.message) ||
    error.message.startsWith('No highlights found'));

// Errors whose message is already the sentence the user should read.
const MESSAGE_IS_REASON_NAMES = [
  'ImageOnlyContentError',
  'EpubTooLargeError',
] as const;

const carriesItsOwnReason = (error: unknown): error is Error =>
  MESSAGE_IS_REASON_NAMES.some((name) => hasName(error, name));

// The synchronous upload path turns this sentinel into the enter-a-password
// state; the async (job) path has no such state, so the job needs the same
// message pdfinfo's own password error gets, not the generic fallback.
const isLockedPdfError = (error: unknown): error is Error =>
  error instanceof Error &&
  (error.message.startsWith('pdfinfo_password') ||
    isPdfPasswordSentinel(error.message));

export type JobFailureReasonCode =
  | 'empty_deck'
  | 'markdown_likely_lossy'
  | 'python_crash'
  | 'columns_ambiguous'
  | 'notion_token_expired'
  | 'parser_crash'
  | 'worker_timeout'
  | 'notion_rate_limited'
  | 'notion_not_found'
  | 'notion_database_not_page'
  | 'apkg_too_large'
  | 'zip_invalid'
  | 'already_anki_deck'
  | 'pdf_password'
  | 'pdf_unreadable'
  | 'docx_unreadable'
  | 'no_highlights'
  | 'epub_too_large'
  | 'image_only'
  | 'deck_too_large'
  | 'claude_parse_failed'
  | 'claude_large_section'
  | 'empty_content'
  | 'conversion_process_crashed'
  | 'unknown';

export function jobFailureReasonCode(error: unknown): JobFailureReasonCode {
  if (isConversionChildCrashedError(error)) {
    return 'conversion_process_crashed';
  }
  if (error instanceof EmptyDeckError) {
    return error.sourceFormat === 'markdown'
      ? 'markdown_likely_lossy'
      : 'empty_deck';
  }
  if (
    error instanceof ClaudeLargeSectionError ||
    hasName(error, 'ClaudeLargeSectionError')
  ) {
    return 'claude_large_section';
  }
  if (
    error instanceof EmptyContentError ||
    hasName(error, 'EmptyContentError')
  ) {
    return 'empty_content';
  }
  if (
    hasName(error, 'PythonZeroCardsError') ||
    hasName(error, 'EmptyDeckError')
  ) {
    return 'empty_deck';
  }
  if (error instanceof PythonExitError || hasName(error, 'PythonExitError')) {
    return 'python_crash';
  }
  if (hasName(error, 'ClaudeParseError')) {
    return 'claude_parse_failed';
  }
  if (hasName(error, 'ImageOnlyContentError')) {
    return 'image_only';
  }
  if (hasName(error, 'DeckTooLargeError')) {
    return 'deck_too_large';
  }
  if (hasName(error, 'EpubTooLargeError')) {
    return 'epub_too_large';
  }
  if (isNoHighlightsError(error)) {
    return 'no_highlights';
  }
  if (isDocxParseError(error)) {
    return 'docx_unreadable';
  }
  if (isColumnsAmbiguousError(error)) {
    return 'columns_ambiguous';
  }
  if (isNotionUnauthorizedError(error)) {
    return 'notion_token_expired';
  }
  if (hasCode(error, 'PARSER_CRASH')) {
    return 'parser_crash';
  }
  if (hasCode(error, 'WORKER_TIMEOUT')) {
    return 'worker_timeout';
  }
  if (
    error instanceof APIResponseError &&
    error.code === APIErrorCode.RateLimited
  ) {
    return 'notion_rate_limited';
  }
  if (
    error instanceof APIResponseError &&
    error.code === APIErrorCode.ObjectNotFound
  ) {
    return 'notion_not_found';
  }
  if (isNotionDatabaseNotPageError(error)) {
    return 'notion_database_not_page';
  }
  if (hasCode(error, 'APKG_TOO_LARGE')) {
    return 'apkg_too_large';
  }
  if (hasCode(error, 'ZIP_INVALID') || hasName(error, 'IncompleteZipError')) {
    return 'zip_invalid';
  }
  if (error instanceof Error && /already an Anki deck/.test(error.message)) {
    return 'already_anki_deck';
  }
  if (isLockedPdfError(error)) {
    return 'pdf_password';
  }
  if (
    error instanceof Error &&
    /^pdfinfo_(failed|spawn_failed)/.test(error.message)
  ) {
    return 'pdf_unreadable';
  }
  return 'unknown';
}

export function jobFailureReasonFromError(
  error: unknown,
  jobId?: string
): string {
  if (isConversionChildCrashedError(error)) {
    return CONVERSION_PROCESS_CRASHED_REASON;
  }
  if (error instanceof EmptyDeckError) {
    if (error.sourceFormat === 'markdown') {
      return MARKDOWN_LIKELY_LOSSY_REASON;
    }
    return EMPTY_DECK_FAILURE_REASON;
  }
  if (
    hasName(error, 'PythonZeroCardsError') ||
    hasName(error, 'EmptyDeckError')
  ) {
    return EMPTY_DECK_FAILURE_REASON;
  }
  if (hasName(error, 'ClaudeParseError')) {
    return CLAUDE_PARSE_FAILED_REASON;
  }
  if (hasName(error, 'DeckTooLargeError')) {
    return DECK_TOO_LARGE_REASON;
  }
  if (carriesItsOwnReason(error) || isNoHighlightsError(error)) {
    return error.message;
  }
  if (isDocxParseError(error)) {
    return DOCX_UNREADABLE_REASON;
  }
  // The worker serializes errors down to {message, name} and the multi-chunk
  // path re-wraps into a plain Error carrying only the message, so match both.
  if (
    error instanceof Error &&
    (error.name === 'AiCreditsExhaustedError' ||
      error.message.includes("You're out of AI credits"))
  ) {
    return error.message;
  }
  if (
    error instanceof ClaudeLargeSectionError ||
    hasName(error, 'ClaudeLargeSectionError')
  ) {
    return (error as Error).message;
  }
  if (error instanceof Error && /already an Anki deck/.test(error.message)) {
    return error.message;
  }
  if (
    error instanceof EmptyContentError ||
    hasName(error, 'EmptyContentError')
  ) {
    return (error as Error).message;
  }
  if (
    (error instanceof FileConversionError ||
      hasName(error, 'FileConversionError')) &&
    (error as Error).message === CONVERSION_TRUNCATED_MESSAGE
  ) {
    return (error as Error).message;
  }
  if (error instanceof PythonExitError || hasName(error, 'PythonExitError')) {
    return (error as Error).message;
  }
  if (isColumnsAmbiguousError(error)) {
    return buildColumnsAmbiguousReason(error.columns);
  }
  if (isNotionUnauthorizedError(error)) {
    return NOTION_TOKEN_EXPIRED_REASON;
  }
  if (hasCode(error, 'PARSER_CRASH')) {
    return "Couldn't read this file. It may be malformed or use a structure we don't recognise yet. Try re-exporting from the source app, or send the file to support@2anki.net.";
  }
  if (hasCode(error, 'WORKER_TIMEOUT')) {
    return 'This conversion took longer than the time budget. Try splitting the file into smaller pieces, or remove very large embedded images.';
  }
  if (
    error instanceof APIResponseError &&
    error.code === APIErrorCode.RateLimited
  ) {
    return 'Notion is rate-limiting us right now. Wait a minute and convert again.';
  }
  if (
    error instanceof APIResponseError &&
    error.code === APIErrorCode.ObjectNotFound
  ) {
    return "We couldn't open that Notion page. Share it with the 2anki integration in Notion, then try again.";
  }
  if (isNotionDatabaseNotPageError(error)) {
    return NOTION_DATABASE_NOT_PAGE_REASON;
  }
  if (hasCode(error, 'APKG_TOO_LARGE')) {
    return "This deck is over Anki's 100 MB upload limit. Split it by toggling fewer pages, or upload directly to Anki desktop.";
  }
  if (hasCode(error, 'ZIP_INVALID') || hasName(error, 'IncompleteZipError')) {
    return (error as Error).message;
  }
  if (isLockedPdfError(error)) {
    return 'This PDF is password-protected. Remove the password and try again.';
  }
  if (
    error instanceof Error &&
    /^pdfinfo_(failed|spawn_failed)/.test(error.message)
  ) {
    return 'We could not read this PDF. It may be corrupted, password-protected, or an unsupported variant. Try re-exporting the PDF or splitting it into smaller files.';
  }
  return genericFailureReason(jobId);
}
