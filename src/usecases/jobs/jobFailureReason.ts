import { APIResponseError, APIErrorCode } from '@notionhq/client';
import { PythonExitError } from '../../lib/anki/buildPythonExitError';
import { ClaudeLargeSectionError } from '../../lib/claude/ClaudeService';
import {
  CONVERSION_TRUNCATED_MESSAGE,
  FileConversionError,
} from '../../infrastracture/adapters/fileConversion/claudeFileConversion';
import { EmptyDeckError } from './EmptyDeckError';
import { inferColumnMapping } from '../../lib/notionDatabase/inferColumnMapping';
import { isNotionDatabaseNotPageError } from '../../services/NotionService/helpers/isNotionDatabaseNotPageError';

export const NOTION_DATABASE_NOT_PAGE_REASON =
  'This Notion link points to a database. We read the database rows as cards — share the database with the 2anki integration in Notion, then convert again.';

export const NOTION_TOKEN_EXPIRED_REASON = 'notion_token_expired';

export const EMPTY_DECK_FAILURE_REASON =
  "No cards in this deck yet. 2anki makes a card from every Notion toggle — the toggle title becomes the question, what's inside becomes the answer. Wrap your key terms in toggles, then convert again.";

export const MARKDOWN_LIKELY_LOSSY_REASON =
  'Notion Markdown exports flatten toggles — re-export this page as HTML and the toggles become flashcards.';

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
  | 'pdf_password'
  | 'pdf_unreadable'
  | 'claude_large_section'
  | 'unknown';

export function jobFailureReasonCode(error: unknown): JobFailureReasonCode {
  if (error instanceof EmptyDeckError) {
    return error.sourceFormat === 'markdown'
      ? 'markdown_likely_lossy'
      : 'empty_deck';
  }
  if (error instanceof ClaudeLargeSectionError) {
    return 'claude_large_section';
  }
  if (hasName(error, 'PythonZeroCardsError')) {
    return 'empty_deck';
  }
  if (error instanceof PythonExitError) {
    return 'python_crash';
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
  if (error instanceof Error && error.message.startsWith('pdfinfo_password')) {
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
  if (error instanceof EmptyDeckError) {
    if (error.sourceFormat === 'markdown') {
      return MARKDOWN_LIKELY_LOSSY_REASON;
    }
    return EMPTY_DECK_FAILURE_REASON;
  }
  if (hasName(error, 'PythonZeroCardsError')) {
    return EMPTY_DECK_FAILURE_REASON;
  }
  if (
    error instanceof ClaudeLargeSectionError ||
    hasName(error, 'ClaudeLargeSectionError')
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
  if (error instanceof Error && error.message.startsWith('pdfinfo_password')) {
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
