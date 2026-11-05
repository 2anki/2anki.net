import { PythonExitError } from './buildPythonExitError';

const RAW_OUTPUT_MAX_LENGTH = 500;

const SCRUBBED_FILE_EXTENSIONS = [
  'html',
  'htm',
  'md',
  'markdown',
  'csv',
  'txt',
  'zip',
  'apkg',
  'colpkg',
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'xlsx',
];
const QUOTED_FILENAME_PATTERN = new RegExp(
  `(['"])[^'"\\n]{0,200}\\.(?:${SCRUBBED_FILE_EXTENSIONS.join('|')})\\1`,
  'gi'
);
const ABSOLUTE_PATH_PATTERN = /(?:\/[\w.@%+~-]+){2,}/g;
const EMAIL_PATTERN = /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g;
const TOKEN_PATTERN = /\b[A-Za-z0-9_-]{32,}\b/g;

function redactPath(path: string): string {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  return basename.endsWith('.py') ? basename : '[path]';
}

function redactPythonOutput(rawOutput: string): string {
  return rawOutput
    .replace(QUOTED_FILENAME_PATTERN, '[file]')
    .replace(ABSOLUTE_PATH_PATTERN, redactPath)
    .replace(EMAIL_PATTERN, '[email]')
    .replace(TOKEN_PATTERN, '[token]');
}

export function scrubPythonRawOutput(rawOutput: string): string {
  return redactPythonOutput(rawOutput).slice(0, RAW_OUTPUT_MAX_LENGTH);
}

// A traceback names the exception on its last line, so a log keeps the end.
export function scrubPythonRawOutputTail(rawOutput: string): string {
  return redactPythonOutput(rawOutput).slice(-RAW_OUTPUT_MAX_LENGTH);
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
