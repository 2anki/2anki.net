import { describe, expect, it } from 'vitest';
import {
  assertPagesWithinDocument,
  isPdfPageRangeError,
  parsePdfPageRange,
  PdfPageRangeError,
} from './pdfPageRange';

describe('parsePdfPageRange', () => {
  it('returns null for an empty or whitespace value', () => {
    expect(parsePdfPageRange('')).toBeNull();
    expect(parsePdfPageRange('   ')).toBeNull();
    expect(parsePdfPageRange(undefined)).toBeNull();
    expect(parsePdfPageRange(null)).toBeNull();
  });

  it('expands ranges and single pages into a sorted de-duped list', () => {
    expect(parsePdfPageRange('12-30, 45')).toEqual([
      12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
      30, 45,
    ]);
  });

  it('de-duplicates overlapping ranges and reorders out-of-order input', () => {
    expect(parsePdfPageRange('5, 1-3, 2')).toEqual([1, 2, 3, 5]);
  });

  it('accepts whitespace around separators and hyphens', () => {
    expect(parsePdfPageRange(' 2 - 4 ,  7 ')).toEqual([2, 3, 4, 7]);
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
});

describe('assertPagesWithinDocument', () => {
  it('passes when every page is within the document', () => {
    expect(() => assertPagesWithinDocument([1, 2, 98], 98)).not.toThrow();
  });

  it('names the out-of-range span and the real page count', () => {
    try {
      assertPagesWithinDocument([120, 125, 130], 98);
      throw new Error('expected assertion to throw');
    } catch (error) {
      expect(isPdfPageRangeError(error)).toBe(true);
      expect((error as Error).message).toBe(
        'Pages 120-130 are past the end of this 98-page PDF.'
      );
    }
  });

  it('uses the singular form for a single out-of-range page', () => {
    try {
      assertPagesWithinDocument([5, 99], 98);
      throw new Error('expected assertion to throw');
    } catch (error) {
      expect((error as Error).message).toBe(
        'Page 99 is past the end of this 98-page PDF.'
      );
    }
  });
});
