import { isTextShapedPdf } from './isTextShapedPdf';
import type { PdfExtractionResult, PdfPage } from './extractPdfText';

function makeProsePages(count: number): PdfPage[] {
  return Array.from({ length: count }, (_, i) => ({
    text: `Page ${i + 1}. ${'A line of real extractable study text on this page. '.repeat(
      4 + (i % 5)
    )}`,
    imagePaintCount: 0,
  }));
}

function makeExtraction(
  overrides: Partial<PdfExtractionResult> = {}
): PdfExtractionResult {
  const pages = makeProsePages(10);
  const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
  return {
    pages,
    pageCount: 10,
    avgCharsPerPage: totalChars / 10,
    isDrmLocked: false,
    needsCredential: false,
    coloredTextPageCount: 0,
    ...overrides,
  };
}

function makeImageCardPages(count: number): PdfPage[] {
  return Array.from({ length: count }, (_, i) => ({
    text:
      i % 2 === 0
        ? 'What is the term on this card?'
        : 'The definition of the term.',
    imagePaintCount: 1,
  }));
}

function makeImageCardExtraction(pageCount: number): PdfExtractionResult {
  const pages = makeImageCardPages(pageCount);
  const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
  return {
    pages,
    pageCount,
    avgCharsPerPage: totalChars / pageCount,
    isDrmLocked: false,
    needsCredential: false,
    coloredTextPageCount: 0,
  };
}

describe('isTextShapedPdf', () => {
  it('returns true when every page has varied text and no page images', () => {
    expect(isTextShapedPdf(makeExtraction())).toBe(true);
  });

  it('returns true at exactly 80% page coverage', () => {
    const pages = [
      ...makeProsePages(8),
      { text: '', imagePaintCount: 0 },
      { text: '   ', imagePaintCount: 0 },
    ];
    expect(isTextShapedPdf(makeExtraction({ pages }))).toBe(true);
  });

  it('returns false below 80% page coverage', () => {
    const pages = [
      ...makeProsePages(7),
      { text: '', imagePaintCount: 0 },
      { text: '', imagePaintCount: 0 },
      { text: '', imagePaintCount: 0 },
    ];
    expect(isTextShapedPdf(makeExtraction({ pages }))).toBe(false);
  });

  it('returns false below 200 average chars per page', () => {
    const pages = Array.from({ length: 10 }, () => ({
      text: 'short',
      imagePaintCount: 0,
    }));
    expect(
      isTextShapedPdf(makeExtraction({ pages, avgCharsPerPage: 199 }))
    ).toBe(false);
  });

  it('returns false for a DRM-locked PDF', () => {
    expect(isTextShapedPdf(makeExtraction({ isDrmLocked: true }))).toBe(false);
  });

  it('returns false when a credential is still needed', () => {
    expect(isTextShapedPdf(makeExtraction({ needsCredential: true }))).toBe(
      false
    );
  });

  it('returns false for an empty PDF', () => {
    expect(
      isTextShapedPdf(
        makeExtraction({ pages: [], pageCount: 0, avgCharsPerPage: 0 })
      )
    ).toBe(false);
  });

  it('returns false for a scanned card deck — image on every page with a thin uniform text layer', () => {
    expect(isTextShapedPdf(makeImageCardExtraction(6))).toBe(false);
    expect(isTextShapedPdf(makeImageCardExtraction(228))).toBe(false);
  });

  it('returns true for a slide deck — figures on some pages, substantial varied text', () => {
    const pages = Array.from({ length: 12 }, (_, i) => ({
      text: `Slide ${i + 1}: ${'Detailed lecture content covering the topic in depth. '.repeat(
        5 + (i % 4)
      )}`,
      imagePaintCount: i % 2 === 0 ? 1 : 0,
    }));
    const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
    const extraction: PdfExtractionResult = {
      pages,
      pageCount: 12,
      avgCharsPerPage: totalChars / 12,
      isDrmLocked: false,
      needsCredential: false,
      coloredTextPageCount: 0,
    };
    expect(isTextShapedPdf(extraction)).toBe(true);
  });

  it('returns false for a uniform full-page-image deck even when its OCR layer is dense', () => {
    const denseLine =
      'Pharmacology term and its full definition spelled out clearly here. ';
    const pages = Array.from({ length: 20 }, (_, i) => ({
      text: `${denseLine.repeat(4)}${i % 2 === 0 ? 'front' : 'back'}`,
      imagePaintCount: 1,
    }));
    const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
    const extraction: PdfExtractionResult = {
      pages,
      pageCount: 20,
      avgCharsPerPage: totalChars / 20,
      isDrmLocked: false,
      needsCredential: false,
      coloredTextPageCount: 0,
    };
    expect(isTextShapedPdf(extraction)).toBe(false);
  });

  it('still routes prose to text even when an odd page carries an inline figure', () => {
    const pages = makeProsePages(10).map((p, i) => ({
      ...p,
      imagePaintCount: i === 3 ? 1 : 0,
    }));
    expect(isTextShapedPdf(makeExtraction({ pages }))).toBe(true);
  });
});
