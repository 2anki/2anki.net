const RAW_OUTPUT_MAX_LENGTH = 500;
// Only the whole lines within this many characters of the kept slice are
// redacted (the output arrives trimmed), so a warning repeated thousands of
// times stays cheap and no line is redacted from half its text.
const REDACTION_WINDOW = 20_000;
// One line longer than the window can't be redacted whole, so none of it is kept.
const TRUNCATED = '[truncated]';

// Every quoted value is read as one token, so each one uses up its own closing
// quote and a closing quote is never paired with the next value's opening one.
// A quote counts only when no letter or digit touches it on the outside (the
// apostrophe in "Couldn't" is not a quote), and a Python string prefix (b'',
// u'', rb'') belongs to the literal.
const QUOTED_PATTERN =
  /(?<![\p{L}\p{N}_])[bBuUrRfF]{0,2}("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')(?![\p{L}\p{N}_])/gu;
const FILE_EXTENSION = /\.(\w{1,8})$/;
const WHITESPACE = /[^\S\n]/;

// Once a path starts, everything up to the end of the line or a quote is its
// name, prose after it included: user file names hold spaces, colons,
// apostrophes and non-ASCII letters. Only a frame's ":<line>:" ("create_deck.py:159:
// UserWarning") ends it early.
const ABSOLUTE_PATH_PATTERN =
  /(?:\/(?:[^\s/'":]|'(?=\p{L})|:(?!\d+:))+){2,}(?:[^\S\n](?:[^\n'":]|'(?=\p{L})|:(?!\d+:))*)?/gu;
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
  return lastBreak === -1 ? TRUNCATED : window.slice(0, lastBreak);
}

function lastWholeLines(rawOutput: string): string {
  if (rawOutput.length <= REDACTION_WINDOW) return rawOutput;
  const window = rawOutput.slice(-REDACTION_WINDOW);
  const firstBreak = window.indexOf('\n');
  return firstBreak === -1 ? TRUNCATED : window.slice(firstBreak + 1);
}

// A quoted name ending in an extension is a file, except the deck writer's own
// .py frames, which the path pass trims to their basename. Any other quoted
// value with whitespace in it is user text (a deck name, a card front); a
// one-word value usually names the failing field and is kept.
function redactQuoted(token: string, quoted: string): string {
  const value = quoted.slice(1, -1);
  const extension = FILE_EXTENSION.exec(value)?.[1];
  if (extension != null) {
    return extension.toLowerCase() === 'py' ? token : '[file]';
  }
  return WHITESPACE.test(value) ? '[text]' : token;
}

function redactPythonOutput(rawOutput: string): string {
  return rawOutput
    .replace(QUOTED_PATTERN, redactQuoted)
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
