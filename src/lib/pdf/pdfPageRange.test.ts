import { describe, expect, it } from 'vitest';
import {
  isPdfPageRangeError,
  parsePdfPageRange,
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
