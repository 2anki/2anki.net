import { describe, expect, it } from 'vitest';
import {
  isPdfPageRangeError,
  parsePdfPageRange,
  pdfPageRangeDetailsOf,
  PdfPageRangeError,
  resolvePdfPages,
} from './pdfPageRange';

describe('parsePdfPageRange', () => {
  it('returns null for an empty or whitespace value', () => {
    expect(parsePdfPageRange('')).toBeNull();
    expect(parsePdfPageRange('   ')).toBeNull();
    expect(parsePdfPageRange(undefined)).toBeNull();
    expect(parsePdfPageRange(null)).toBeNull();
  });

  it('parses ranges and single pages into segments without expanding them', () => {
    expect(parsePdfPageRange('12-30, 45')).toEqual([
      { start: 12, end: 30 },
      { start: 45, end: 45 },
    ]);
  });

  it('accepts whitespace around separators and hyphens', () => {
    expect(parsePdfPageRange(' 2 - 4 ,  7 ')).toEqual([
      { start: 2, end: 4 },
      { start: 7, end: 7 },
    ]);
  });

  it('rejects a malformed token with a message that names it', () => {
    try {
      parsePdfPageRange('12-30, pages');
      throw new Error('expected parse to throw');
    } catch (error) {
      expect(isPdfPageRangeError(error)).toBe(true);
      expect((error as Error).message).toContain("'pages'");
      expect((error as Error).message).toContain('12-30, 45');
    }
  });

  it('rejects page 0', () => {
    expect(() => parsePdfPageRange('0')).toThrow(PdfPageRangeError);
    expect(() => parsePdfPageRange('0-5')).toThrow(PdfPageRangeError);
  });

  it('rejects a descending range and suggests the corrected order', () => {
    try {
      parsePdfPageRange('30-12');
      throw new Error('expected parse to throw');
    } catch (error) {
      expect(isPdfPageRangeError(error)).toBe(true);
      expect((error as Error).message).toContain('12-30');
    }
  });

  // The downloads page keys its copy off this wording (web ConversionResult).
  it('names an over-long page number in the wording the downloads page matches', () => {
    expect(() => parsePdfPageRange('1234567')).toThrow(
      "'1234567' has a page number that is too large. Use page numbers from your PDF, like 12-30, 45."
    );
  });

  it('rejects a page number with too many digits before expanding anything', () => {
    expect(() => parsePdfPageRange('1-999999999')).toThrow(PdfPageRangeError);
    expect(() => parsePdfPageRange('1234567')).toThrow(PdfPageRangeError);
  });

  it('rejects an input string that is too long', () => {
    const huge = '1,'.repeat(200);
    expect(() => parsePdfPageRange(huge)).toThrow(PdfPageRangeError);
  });

  it('rejects too many comma-separated parts', () => {
    const manyParts = Array.from({ length: 51 }, (_, i) => i + 1).join(',');
    expect(() => parsePdfPageRange(manyParts)).toThrow(PdfPageRangeError);
  });
});

describe('resolvePdfPages', () => {
  it('expands segments into a sorted de-duped page list', () => {
    const pages = resolvePdfPages(
      [
        { start: 12, end: 14 },
        { start: 13, end: 13 },
        { start: 45, end: 45 },
      ],
      50
    );
    expect(pages).toEqual([12, 13, 14, 45]);
  });

  it('rejects a huge range against a small page count without expanding it', () => {
    try {
      resolvePdfPages([{ start: 1, end: 999999 }], 10);
      throw new Error('expected resolve to throw');
    } catch (error) {
      expect(isPdfPageRangeError(error)).toBe(true);
      expect((error as Error).message).toBe(
        'Pages 11-999999 are past the end of this 10-page PDF.'
      );
    }
  });

  it('names the out-of-range span and the real page count', () => {
    try {
      resolvePdfPages([{ start: 120, end: 130 }], 98);
      throw new Error('expected resolve to throw');
    } catch (error) {
      expect((error as Error).message).toBe(
        'Pages 120-130 are past the end of this 98-page PDF.'
      );
    }
  });

  it('uses the singular form for a single out-of-range page', () => {
    try {
      resolvePdfPages(
        [
          { start: 5, end: 5 },
          { start: 99, end: 99 },
        ],
        98
      );
      throw new Error('expected resolve to throw');
    } catch (error) {
      expect((error as Error).message).toBe(
        'Page 99 is past the end of this 98-page PDF.'
      );
    }
  });
});

function rangeError(run: () => unknown): PdfPageRangeError {
  try {
    run();
  } catch (error) {
    return error as PdfPageRangeError;
  }
  throw new Error('no page range error');
}

describe('page range error details', () => {
  it.each([
    ['too long', 'x'.repeat(201), { reason: 'too_long', max: 200 }],
    [
      'too many parts',
      Array.from({ length: 51 }, (_, i) => String(i + 1)).join(','),
      { reason: 'too_many_parts', max: 50 },
    ],
    [
      'a number too large',
      '1234567',
      { reason: 'number_too_large', part: '1234567' },
    ],
    ['a range from 0', '0-3', { reason: 'range_starts_at_zero', part: '0-3' }],
    [
      'a backwards range',
      '30-12',
      { reason: 'backwards', part: '30-12', lower: 12, upper: 30 },
    ],
    ['page 0', '0', { reason: 'page_zero', part: '0' }],
    ['a word', 'abc', { reason: 'invalid_part', part: 'abc' }],
  ])('names %s with the values the sentence uses', (_case, raw, details) => {
    expect(rangeError(() => parsePdfPageRange(raw)).details).toEqual(details);
  });

  it.each([
    [
      [{ start: 12, end: 12 }],
      { reason: 'past_end', first: 12, last: 12, pageCount: 10 },
    ],
    [
      [{ start: 8, end: 14 }],
      { reason: 'past_end', first: 11, last: 14, pageCount: 10 },
    ],
  ])('names the pages past the end of the PDF', (segments, details) => {
    expect(rangeError(() => resolvePdfPages(segments, 10)).details).toEqual(
      details
    );
  });

  it('reads the details back off an error rebuilt as plain data', () => {
    const rebuilt = Object.assign(new Error('rebuilt'), {
      name: 'PdfPageRangeError',
      details: { reason: 'backwards', part: '30-12', lower: 12, upper: 30 },
    });

    expect(pdfPageRangeDetailsOf(rebuilt)).toEqual({
      reason: 'backwards',
      part: '30-12',
      lower: 12,
      upper: 30,
    });
  });

  it.each([
    ['no details', {}],
    ['an unknown reason', { details: { reason: 'toString' } }],
    [
      'a reason missing its values',
      { details: { reason: 'past_end', first: 3 } },
    ],
    ['a part that is not text', { details: { reason: 'page_zero', part: 0 } }],
  ])('reads %s as none', (_case, extra) => {
    expect(
      pdfPageRangeDetailsOf(Object.assign(new Error('x'), extra))
    ).toBeNull();
  });
});
