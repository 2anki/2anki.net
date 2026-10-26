import {
  buildPdfFallbackChoiceSentinel,
  isPdfFallbackChoiceSentinel,
  parsePdfFallbackChoiceSentinel,
} from './pdfFallbackChoice';

describe('pdf fallback choice sentinel', () => {
  it('round-trips the reason and page count', () => {
    const message = buildPdfFallbackChoiceSentinel({
      reason: 'no_text',
      pageCount: 42,
    });

    expect(isPdfFallbackChoiceSentinel(message)).toBe(true);
    expect(parsePdfFallbackChoiceSentinel(message)).toEqual({
      reason: 'no_text',
      pageCount: 42,
    });
  });

  it('ignores ordinary errors and unknown reasons', () => {
    expect(isPdfFallbackChoiceSentinel('PDF could not be read')).toBe(false);
    expect(parsePdfFallbackChoiceSentinel('PDF could not be read')).toBeNull();
    expect(
      parsePdfFallbackChoiceSentinel('PDF_NEEDS_MODE_CHOICE\x00weird\x005')
    ).toBeNull();
  });

  it('treats a missing or bad page count as unknown', () => {
    expect(
      parsePdfFallbackChoiceSentinel('PDF_NEEDS_MODE_CHOICE\x00locked\x00x')
    ).toEqual({ reason: 'locked', pageCount: 0 });
  });
});
