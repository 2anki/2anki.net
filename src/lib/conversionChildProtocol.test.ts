import { describe, expect, it } from 'vitest';
import {
  rebuildTaskError,
  serializeTaskError,
} from './conversionChildProtocol';
import { PdfPageRangeError } from './pdf/pdfPageRange';

describe('task errors across the conversion child', () => {
  it("keeps a page range error's details", () => {
    const rebuilt = rebuildTaskError(
      serializeTaskError(
        new PdfPageRangeError('past the end', {
          reason: 'past_end',
          first: 11,
          last: 14,
          pageCount: 10,
        })
      )
    ) as Error & { details?: unknown };

    expect(rebuilt.name).toBe('PdfPageRangeError');
    expect(rebuilt.details).toEqual({
      reason: 'past_end',
      first: 11,
      last: 14,
      pageCount: 10,
    });
  });

  it('carries only plain values of a page range error', () => {
    const withNested = Object.assign(new Error('x'), {
      name: 'PdfPageRangeError',
      details: { reason: 'locked_pdf', nested: { a: 1 }, run: () => 1 },
    });

    expect(serializeTaskError(withNested).details).toEqual({
      reason: 'locked_pdf',
    });
  });

  it('carries no details for any other error', () => {
    const thirdParty = Object.assign(new Error('x'), {
      details: { token: 'secret-value' },
    });

    expect(serializeTaskError(thirdParty).details).toBeUndefined();
    expect(serializeTaskError(new Error('plain')).details).toBeUndefined();
  });
});
