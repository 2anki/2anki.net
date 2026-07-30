import { MAX_LOGGED_LENGTH, sanitizeForLog } from './sanitizeForLog';

const CR = String.fromCharCode(0x0d);
const LF = String.fromCharCode(0x0a);
const NUL = String.fromCharCode(0x00);
const ESC = String.fromCharCode(0x1b);
const DEL = String.fromCharCode(0x7f);

describe('sanitizeForLog', () => {
  it('leaves an ordinary value untouched', () => {
    expect(sanitizeForLog('https://2anki.net')).toBe('https://2anki.net');
  });

  it('keeps spaces and hyphens, which an earlier regex draft destroyed', () => {
    expect(sanitizeForLog('a b-c')).toBe('a b-c');
  });

  it.each([
    ['CR', CR],
    ['LF', LF],
    ['NUL', NUL],
    ['ESC', ESC],
    ['DEL', DEL],
  ])('replaces %s so it cannot forge a log line', (_name, control) => {
    const sanitized = sanitizeForLog(`before${control}after`);

    expect(sanitized).toBe('before?after');
    expect(sanitized).not.toContain(control);
  });

  it('defeats a full forged log line', () => {
    const forged = `evil.example.com${CR}${LF}[events] admin granted access`;

    expect(sanitizeForLog(forged)).toBe(
      'evil.example.com??[events] admin granted access'
    );
  });

  it('caps a flooding value', () => {
    const sanitized = sanitizeForLog('x'.repeat(MAX_LOGGED_LENGTH + 50));

    expect(sanitized).toHaveLength(MAX_LOGGED_LENGTH + 1);
    expect(sanitized.endsWith('…')).toBe(true);
  });

  it('does not cap a value exactly at the limit', () => {
    expect(sanitizeForLog('x'.repeat(MAX_LOGGED_LENGTH))).toHaveLength(
      MAX_LOGGED_LENGTH
    );
  });

  it('serializes non-string values', () => {
    expect(sanitizeForLog({ id: 7 })).toBe('{"id":7}');
    expect(sanitizeForLog(42)).toBe('42');
    expect(sanitizeForLog(null)).toBe('null');
  });

  it('reports undefined rather than throwing', () => {
    expect(sanitizeForLog(undefined)).toBe('undefined');
  });
});
