import { inspect, type InspectOptions } from 'node:util';
import type { UploadErrorCode } from '../../types/UploadErrorBody';
import { scrubPythonRawOutputTail } from './redactPythonOutput';

export type PythonCrashKind =
  | 'invalid-markup'
  | 'unsupported-data-source'
  | 'too-large'
  | 'bad-title'
  | 'unknown';

export function toUploadErrorCode(kind: PythonCrashKind): UploadErrorCode {
  if (kind === 'invalid-markup') return 'invalid_markup';
  if (kind === 'unsupported-data-source') return 'malformed_notion';
  if (kind === 'too-large') return 'too_large';
  if (kind === 'bad-title') return 'unknown';
  return 'deck_builder_crash';
}

interface PythonExitInfo {
  code: number | null;
  stdout: string;
  stderr: string;
  jobId?: string;
}

interface PythonExitErrorDetails {
  kind: PythonCrashKind;
  rawOutput: string;
  code: number | null;
}

export class PythonExitError extends Error {
  readonly kind: PythonCrashKind;
  declare readonly rawOutput: string;
  readonly code: number | null;

  constructor(message: string, details: PythonExitErrorDetails) {
    super(message);
    this.name = 'PythonExitError';
    this.kind = details.kind;
    // Kept off the enumerable fields so no log or JSON of the error carries
    // the deck writer's unredacted output; inspect shows the redacted tail.
    Object.defineProperty(this, 'rawOutput', {
      value: details.rawOutput,
      enumerable: false,
    });
    this.code = details.code;
  }

  [inspect.custom](
    _depth: number,
    options: InspectOptions,
    inspectNested: typeof inspect
  ): string {
    const details = {
      kind: this.kind,
      code: this.code,
      output: scrubPythonRawOutputTail(this.rawOutput),
    };
    return `${this.stack ?? `${this.name}: ${this.message}`} ${inspectNested(details, options)}`;
  }
}

const INVALID_MARKUP_MESSAGE =
  "Something on this page — usually a pasted embed or copied-in web content — has formatting we can't read. Open the page in Notion, remove or simplify that block, and convert again.";

const UNSUPPORTED_DATA_SOURCE_MESSAGE =
  "This Notion database uses a view we don't support yet. Convert the parent page, or switch the database to a different view and try again.";

const TOO_LARGE_MESSAGE =
  'This page is too large for us to convert in one go. Split it into smaller pages — or convert it section by section — and try again.';

const BAD_TITLE_MESSAGE =
  'Your page title has a "/" in it, which we can\'t save as a filename. Rename the page in Notion (try a dash or "and") and convert again.';

function genericMessage(jobId: string | undefined): string {
  if (jobId == null || jobId === '') {
    return "Something went wrong on our end converting this page. Email support@2anki.net and we'll take a look.";
  }
  return `Something went wrong on our end converting this page. Email support@2anki.net with job ID ${jobId} and we'll take a look.`;
}

function hasInvalidMarkupSignature(output: string): boolean {
  return output.includes(
    'UserWarning: Field contained the following invalid HTML tags'
  );
}

function hasUnsupportedDataSourceSignature(output: string): boolean {
  return (
    output.includes("Unsupported 'data_source'!") ||
    output.includes('Unsupported "data_source"')
  );
}

function hasTooLargeSignature(output: string, code: number | null): boolean {
  if (code === 137) {
    return true;
  }
  if (output.includes('MemoryError')) {
    return true;
  }
  return output.split('\n').some((line) => line.trim() === 'Killed');
}

function hasBadTitleSignature(output: string): boolean {
  return output.includes('FileNotFoundError') && output.includes("-> '");
}

function classify(
  output: string,
  code: number | null
): Exclude<PythonCrashKind, 'unknown'> | null {
  if (hasInvalidMarkupSignature(output)) {
    return 'invalid-markup';
  }
  if (hasUnsupportedDataSourceSignature(output)) {
    return 'unsupported-data-source';
  }
  if (hasTooLargeSignature(output, code)) {
    return 'too-large';
  }
  if (hasBadTitleSignature(output)) {
    return 'bad-title';
  }
  return null;
}

export function pythonExitMessage(
  kind: PythonCrashKind,
  jobId: string | undefined
): string {
  if (kind === 'invalid-markup') {
    return INVALID_MARKUP_MESSAGE;
  }
  if (kind === 'unsupported-data-source') {
    return UNSUPPORTED_DATA_SOURCE_MESSAGE;
  }
  if (kind === 'too-large') {
    return TOO_LARGE_MESSAGE;
  }
  if (kind === 'bad-title') {
    return BAD_TITLE_MESSAGE;
  }
  return genericMessage(jobId);
}

export function buildPythonExitError({
  code,
  stdout,
  stderr,
  jobId,
}: PythonExitInfo): PythonExitError {
  const trimmedStderr = stderr.trim();
  const trimmedStdout = stdout.trim();
  const rawOutput = trimmedStderr || trimmedStdout;
  const kind: PythonCrashKind = rawOutput
    ? (classify(rawOutput, code) ?? 'unknown')
    : 'unknown';
  return new PythonExitError(pythonExitMessage(kind, jobId), {
    kind,
    rawOutput,
    code,
  });
}
