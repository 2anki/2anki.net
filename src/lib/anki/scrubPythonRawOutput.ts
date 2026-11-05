import { PythonExitError } from './buildPythonExitError';

const RAW_OUTPUT_MAX_LENGTH = 500;
// Only the whole lines within this many characters of the kept slice are
// redacted, so a warning repeated thousands of times stays cheap and no line
// is redacted from half its text.
const REDACTION_WINDOW = 20_000;

// A quote counts only when no word character touches it on the outside, so
// the apostrophe in "Couldn't" or the end of 'Front' in ['Front', 'Back'] is
// never taken for an opening quote.
// A quoted name ending in any extension is a file; a deck-writer .py stays so
// a traceback still names its frame.
const QUOTED_FILENAME_PATTERN =
  /(?<!\w)"[^"\n]{0,200}\.(\w{1,8})"(?!\w)|(?<!\w)'[^'\n]{0,200}\.(\w{1,8})'(?!\w)/g;
// A quoted value with whitespace in it is user text (a deck name, a card
// front); a one-word value usually names the failing field and is kept.
const QUOTED_TEXT_PATTERN =
  /(?<!\w)"[^"\s]*[^\S\n][^"\n]*"(?!\w)|(?<!\w)'[^'\s]*[^\S\n][^'\n]*'(?!\w)/g;
// Once a path starts, everything up to the end of the line, a quote or a
// colon is its name: user file names hold spaces and non-ASCII letters. The
// colon is where a frame ("create_deck.py:159: UserWarning") ends its path.
const ABSOLUTE_PATH_PATTERN = /(?:\/[^\s/'":]+){2,}(?:[^\S\n][^\n'":]*)?/g;
const EMAIL_PATTERN = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g;
const TOKEN_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/g;

function redactPath(path: string): string {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  return !/\s/.test(path) && basename.endsWith('.py') ? basename : '[path]';
}

function firstWholeLines(rawOutput: string): string {
  if (rawOutput.length <= REDACTION_WINDOW) return rawOutput;
  const window = rawOutput.slice(0, REDACTION_WINDOW);
  const lastBreak = window.lastIndexOf('\n');
  return lastBreak === -1 ? rawOutput : window.slice(0, lastBreak);
}

function lastWholeLines(rawOutput: string): string {
  if (rawOutput.length <= REDACTION_WINDOW) return rawOutput;
  const window = rawOutput.slice(-REDACTION_WINDOW);
  const firstBreak = window.indexOf('\n');
  return firstBreak === -1 ? rawOutput : window.slice(firstBreak + 1);
}

function redactQuotedFilename(
  quoted: string,
  doubleQuotedExtension: string | undefined,
  singleQuotedExtension: string | undefined
): string {
  const extension = doubleQuotedExtension ?? singleQuotedExtension ?? '';
  return extension.toLowerCase() === 'py' ? quoted : '[file]';
}

function redactPythonOutput(rawOutput: string): string {
  return rawOutput
    .replace(QUOTED_FILENAME_PATTERN, redactQuotedFilename)
    .replace(QUOTED_TEXT_PATTERN, '[text]')
    .replace(ABSOLUTE_PATH_PATTERN, redactPath)
    .replace(EMAIL_PATTERN, '[email]')
    .replace(TOKEN_PATTERN, '[token]');
}

export function scrubPythonRawOutput(rawOutput: string): string {
  return redactPythonOutput(firstWholeLines(rawOutput)).slice(
    0,
    RAW_OUTPUT_MAX_LENGTH
  );
}

// A traceback names the exception on its last line, so a log keeps the end.
export function scrubPythonRawOutputTail(rawOutput: string): string {
  return redactPythonOutput(lastWholeLines(rawOutput)).slice(
    -RAW_OUTPUT_MAX_LENGTH
  );
}

export function buildUnknownPythonErrorContext(
  err: Error
): Record<string, unknown> | null {
  if (
    err instanceof PythonExitError &&
    err.kind === 'unknown' &&
    err.rawOutput !== ''
  ) {
    return {
      python_crash_kind: err.kind,
      python_exit_code: err.code,
      python_raw_output: scrubPythonRawOutput(err.rawOutput),
    };
  }
  return null;
}
