import {
  getSafeFilename,
  toDownloadBasename,
  truncateToBytes,
} from './getSafeFilename';

test('returns filename without slashes', () => {
  expect(getSafeFilename('x/y/z')).toBe('x-y-z');
});

test('replaces backslashes with dashes', () => {
  expect(getSafeFilename('x\\y\\z')).toBe('x-y-z');
});

test('replaces null bytes with dashes', () => {
  expect(getSafeFilename('x\0y')).toBe('x-y');
});

describe('truncateToBytes', () => {
  test('returns name unchanged when within byte limit', () => {
    expect(truncateToBytes('hello', 200)).toBe('hello');
  });

  test('truncates ASCII-only name at the byte limit', () => {
    const long = 'a'.repeat(300);
    const result = truncateToBytes(long, 200);
    expect(result).toBe('a'.repeat(200));
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(200);
  });

  test('does not split a multi-byte German codepoint (ä = 2 bytes)', () => {
    const long = 'ä'.repeat(150);
    const result = truncateToBytes(long, 200);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(200);
    expect(result).not.toContain('�');
    expect(result).toMatch(/^ä+$/);
  });

  test('does not split a 3-byte CJK codepoint', () => {
    const long = '中'.repeat(100);
    const result = truncateToBytes(long, 200);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(200);
    expect(result).not.toContain('�');
    expect(result).toMatch(/^中+$/);
  });

  test('real German quiz question over 255 bytes truncates cleanly', () => {
    const heading =
      'Engramm-Quiz: Welche der folgenden Aussagen über die synaptische Plastizität ist korrekt? ' +
      'A) LTP erhöht die Anzahl der AMPA-Rezeptoren B) LTD verstärkt die synaptische Übertragung ' +
      'C) Calcium spielt keine Rolle D) NMDA-Rezeptoren sind nicht beteiligt';
    const result = truncateToBytes(heading, 200);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(200);
    expect(result).not.toContain('�');
    expect(result.length).toBeGreaterThan(0);
  });

  test('returns empty string for empty input', () => {
    expect(truncateToBytes('', 200)).toBe('');
  });
});

describe('toDownloadBasename', () => {
  test.each([
    ['PEDİATRİ', 'PEDİATRİ'],
    ['Speicheldrüsen Lernkarten', 'Speicheldrüsen Lernkarten'],
    ['漢字 01', '漢字 01'],
    ['Здравствуйте', 'Здравствуйте'],
    ['नमस्ते', 'नमस्ते'],
    ['deck-v2_final.1', 'deck-v2_final.1'],
  ])('keeps %s readable', (input, expected) => {
    expect(toDownloadBasename(input)).toBe(expected);
  });

  test.each([
    ['../../etc/passwd', '.._.._etc_passwd'],
    ['a\\b', 'a_b'],
    ['say "hi"', 'say _hi_'],
    ["it's", 'it_s'],
    ['line\r\nbreak', 'line__break'],
    ['tab\there', 'tab_here'],
    ['nul\0byte', 'nul_byte'],
    ['semi;colon', 'semi_colon'],
  ])('strips unsafe characters from %j', (input, expected) => {
    expect(toDownloadBasename(input)).toBe(expected);
  });
});
