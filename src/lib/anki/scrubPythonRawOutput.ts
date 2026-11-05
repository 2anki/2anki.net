import { PythonExitError } from './buildPythonExitError';

const RAW_OUTPUT_MAX_LENGTH = 500;
// Only this much is redacted before slicing, so a warning repeated thousands
// of times costs nothing; a cut this far out never reaches the kept slice.
const REDACTION_WINDOW = 20_000;

// A quoted name ending in any extension is a file; a deck-writer .py stays so
// a traceback still names its frame.
const QUOTED_FILENAME_PATTERN =
  /"[^"\n]{0,200}\.(\w{1,8})"|'[^'\n]{0,200}\.(\w{1,8})'/g;
// A quoted value with a space in it is user text (a deck name, a card front);
// a one-word value usually names the failing field and is kept.
const QUOTED_TEXT_PATTERN =
  /"[^"\n \t]*[ \t][^"\n]*"|'[^'\n \t]*[ \t][^'\n]*'/g;
// An unquoted path runs on through spaces to its file extension.
const ABSOLUTE_PATH_PATTERN =
  /(?:\/[\w.@%+~-]+){2,}(?:[ \t][^\n'"]*?\.\w{1,8}\b)?/g;
const EMAIL_PATTERN = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g;
const TOKEN_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/g;

function redactPath(path: string): string {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  return basename.endsWith('.py') ? basename : '[path]';
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
  return redactPythonOutput(rawOutput.slice(0, REDACTION_WINDOW)).slice(
    0,
    RAW_OUTPUT_MAX_LENGTH
  );
}

// A traceback names the exception on its last line, so a log keeps the end.
export function scrubPythonRawOutputTail(rawOutput: string): string {
  return redactPythonOutput(rawOutput.slice(-REDACTION_WINDOW)).slice(
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
