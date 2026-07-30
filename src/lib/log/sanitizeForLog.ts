const MAX_LOGGED_LENGTH = 200;

const CONTROL_PLACEHOLDER = '?';
const DEL_CODE_POINT = 0x7f;
const FIRST_PRINTABLE_CODE_POINT = 0x20;

/**
 * Makes a user-controlled value safe to interpolate into a log line.
 *
 * Without this, a value containing CR/LF forges log entries: a crafted origin
 * header or page id can inject a whole extra line into the prod log and hide or
 * misattribute real activity (CWE-117, tssecurity:S5145). Control characters are
 * replaced rather than dropped, so a tampered value still reads as tampered
 * instead of becoming plausible text, and the result is capped so one caller
 * cannot flood the log.
 *
 * Implemented with a code-point scan rather than a control-character regex
 * because the escape-heavy regex form is easy to get subtly wrong (an early
 * draft of this file shipped `[ -]`, which replaced spaces and hyphens and no
 * control characters at all).
 *
 * This is for values that are safe to see in plaintext. It is NOT a substitute
 * for omitting secrets and PII — tokens, passwords, email addresses and message
 * bodies must not be logged at all, sanitized or otherwise (CWE-532).
 */
export function sanitizeForLog(value: unknown): string {
  const asText = typeof value === 'string' ? value : JSON.stringify(value);
  if (asText == null) return 'undefined';

  let collapsed = '';
  for (const character of asText) {
    const codePoint = character.codePointAt(0) ?? 0;
    const isControl =
      codePoint < FIRST_PRINTABLE_CODE_POINT || codePoint === DEL_CODE_POINT;
    collapsed += isControl ? CONTROL_PLACEHOLDER : character;
  }

  return collapsed.length > MAX_LOGGED_LENGTH
    ? `${collapsed.slice(0, MAX_LOGGED_LENGTH)}…`
    : collapsed;
}

export { MAX_LOGGED_LENGTH };
