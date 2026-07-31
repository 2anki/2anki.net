import {
  convertPdfTextToHtml,
  convertPdfTextToHtmlAuto,
} from './convertPdfTextToHtml';

jest.mock('../../../lib/parser/extractPdfText');
jest.mock('../../../lib/parser/synthesizeCardsFromPdf');

import { extractPdfText } from '../../../lib/parser/extractPdfText';
import { synthesizeCardsFromPdf } from '../../../lib/parser/synthesizeCardsFromPdf';

const mockExtract = extractPdfText as jest.MockedFunction<
  typeof extractPdfText
>;
const mockSynthesize = synthesizeCardsFromPdf as jest.MockedFunction<
  typeof synthesizeCardsFromPdf
>;

describe('convertPdfTextToHtml', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty html when the PDF is DRM-locked', async () => {
    mockExtract.mockResolvedValue({
      pages: [],
      pageCount: 5,
      avgCharsPerPage: 2,
      isDrmLocked: true,
      needsCredential: false,
    });

    const result = await convertPdfTextToHtml(Buffer.from('x'), 'locked.pdf');

    expect(result).toEqual({
      html: '',
      cardCount: 0,
      isDrmLocked: true,
      needsCredential: false,
      droppedImageCount: 0,
    });
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it('returns needsCredential true when extractPdfText signals missing credential', async () => {
    mockExtract.mockResolvedValue({
      pages: [],
      pageCount: 0,
      avgCharsPerPage: 0,
      isDrmLocked: false,
      needsCredential: true,
    });

    const result = await convertPdfTextToHtml(
      Buffer.from('x'),
      'protected.pdf'
    );

    expect(result).toEqual({
      html: '',
      cardCount: 0,
      isDrmLocked: false,
      needsCredential: true,
      droppedImageCount: 0,
    });
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it('wraps each synthesized card in a toggle and reports the count', async () => {
    mockExtract.mockResolvedValue({
      pages: [{ text: 'page one', imagePaintCount: 0 }],
      pageCount: 1,
      avgCharsPerPage: 60,
      isDrmLocked: false,
      needsCredential: false,
    });
    mockSynthesize.mockReturnValue([
      { front: 'Q1', back: 'A1', tags: [] },
      { front: 'Q2', back: 'A2', tags: [] },
    ]);

    const result = await convertPdfTextToHtml(Buffer.from('x'), 'study.pdf');

    expect(result.isDrmLocked).toBe(false);
    expect(result.needsCredential).toBe(false);
    expect(result.cardCount).toBe(2);
    expect(result.html).toContain('<title>study</title>');
    expect(result.html.match(/<ul class="toggle">/g)).toHaveLength(2);
    expect(result.html).toContain('<summary>Q1</summary>');
    expect(result.html).toContain('<p>A1</p>');
  });

  it('reports the summed painted-image count as dropped images', async () => {
    mockExtract.mockResolvedValue({
      pages: [
        { text: 'page one', imagePaintCount: 2 },
        { text: 'page two', imagePaintCount: 4 },
      ],
      pageCount: 2,
      avgCharsPerPage: 60,
      isDrmLocked: false,
      needsCredential: false,
    });
    mockSynthesize.mockReturnValue([{ front: 'Q1', back: 'A1', tags: [] }]);

    const result = await convertPdfTextToHtml(Buffer.from('x'), 'study.pdf');

    expect(result.droppedImageCount).toBe(6);
  });

  it('escapes HTML-sensitive characters in card content', async () => {
    mockExtract.mockResolvedValue({
      pages: [{ text: 'p', imagePaintCount: 0 }],
      pageCount: 1,
      avgCharsPerPage: 60,
      isDrmLocked: false,
      needsCredential: false,
    });
    mockSynthesize.mockReturnValue([
      { front: '<script>alert("x")</script>', back: 'a & b', tags: [] },
    ]);

    const result = await convertPdfTextToHtml(Buffer.from('x'), 'unsafe.pdf');

    expect(result.html).not.toContain('<script>alert');
    expect(result.html).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
    expect(result.html).toContain('a &amp; b');
  });

  it('preserves line breaks inside cards by converting newlines to <br>', async () => {
    mockExtract.mockResolvedValue({
      pages: [{ text: 'p', imagePaintCount: 0 }],
      pageCount: 1,
      avgCharsPerPage: 60,
      isDrmLocked: false,
      needsCredential: false,
    });
    mockSynthesize.mockReturnValue([
      { front: 'line1\nline2', back: 'b', tags: [] },
    ]);

    const result = await convertPdfTextToHtml(Buffer.from('x'), 'multi.pdf');

    expect(result.html).toContain('line1<br>line2');
  });

  it('uses the basename without extension as the page title', async () => {
    mockExtract.mockResolvedValue({
      pages: [{ text: 'p', imagePaintCount: 0 }],
      pageCount: 1,
      avgCharsPerPage: 60,
      isDrmLocked: false,
      needsCredential: false,
    });
    mockSynthesize.mockReturnValue([{ front: 'q', back: 'a', tags: [] }]);

    const result = await convertPdfTextToHtml(
      Buffer.from('x'),
      'Chapter 3.PDF'
    );

    expect(result.html).toContain('<title>Chapter 3</title>');
  });
});

describe('convertPdfTextToHtmlAuto', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function textShapedPages() {
    return Array.from({ length: 5 }, () => ({
      text: [
        'What is osmosis?',
        'Movement of water across a semipermeable membrane down a gradient.',
      ].join('\n'),
      imagePaintCount: 0,
    }));
  }

  it('builds heading-split cards for a text-shaped PDF', async () => {
    mockExtract.mockResolvedValue({
      pages: textShapedPages(),
      pageCount: 5,
      avgCharsPerPage: 320,
      isDrmLocked: false,
      needsCredential: false,
    });

    const result = await convertPdfTextToHtmlAuto(Buffer.from('x'), 'bio.pdf');

    expect(result.isTextShaped).toBe(true);
    expect(result.cardCount).toBe(5);
    expect(result.html).toContain('<summary>What is osmosis?</summary>');
    expect(result.html).toContain(
      '<p>Movement of water across a semipermeable membrane down a gradient.</p>'
    );
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it('reports the summed painted-image count as dropped on a text-shaped PDF', async () => {
    const pages = textShapedPages();
    pages[0].imagePaintCount = 2;
    pages[1].imagePaintCount = 3;
    mockExtract.mockResolvedValue({
      pages,
      pageCount: 5,
      avgCharsPerPage: 320,
      isDrmLocked: false,
      needsCredential: false,
    });

    const result = await convertPdfTextToHtmlAuto(Buffer.from('x'), 'bio.pdf');

    expect(result.isTextShaped).toBe(true);
    expect(result.droppedImageCount).toBe(5);
  });

  it('reports not text-shaped when most pages have no text', async () => {
    mockExtract.mockResolvedValue({
      pages: [
        {
          text: 'Only the cover page has any extractable text on it here.',
          imagePaintCount: 0,
        },
        ...Array.from({ length: 4 }, () => ({ text: '', imagePaintCount: 0 })),
      ],
      pageCount: 5,
      avgCharsPerPage: 320,
      isDrmLocked: false,
      needsCredential: false,
    });

    const result = await convertPdfTextToHtmlAuto(Buffer.from('x'), 'scan.pdf');

    expect(result).toEqual({
      html: '',
      cardCount: 0,
      isDrmLocked: false,
      needsCredential: false,
      droppedImageCount: 0,
      isTextShaped: false,
      overSplit: false,
      pageCount: 5,
    });
  });

  it('reports not text-shaped when the average chars per page is low', async () => {
    mockExtract.mockResolvedValue({
      pages: textShapedPages(),
      pageCount: 5,
      avgCharsPerPage: 40,
      isDrmLocked: false,
      needsCredential: false,
    });

    const result = await convertPdfTextToHtmlAuto(Buffer.from('x'), 'thin.pdf');

    expect(result.isTextShaped).toBe(false);
    expect(result.cardCount).toBe(0);
  });

  it('passes through DRM-locked PDFs as not text-shaped', async () => {
    mockExtract.mockResolvedValue({
      pages: [],
      pageCount: 5,
      avgCharsPerPage: 2,
      isDrmLocked: true,
      needsCredential: false,
    });

    const result = await convertPdfTextToHtmlAuto(
      Buffer.from('x'),
      'locked.pdf'
    );

    expect(result).toEqual({
      html: '',
      cardCount: 0,
      isDrmLocked: true,
      needsCredential: false,
      droppedImageCount: 0,
      isTextShaped: false,
      overSplit: false,
      pageCount: 5,
    });
  });

  it('passes through needsCredential for password-protected PDFs', async () => {
    mockExtract.mockResolvedValue({
      pages: [],
      pageCount: 0,
      avgCharsPerPage: 0,
      isDrmLocked: false,
      needsCredential: true,
    });

    const result = await convertPdfTextToHtmlAuto(
      Buffer.from('x'),
      'protected.pdf'
    );

    expect(result).toEqual({
      html: '',
      cardCount: 0,
      isDrmLocked: false,
      needsCredential: true,
      droppedImageCount: 0,
      isTextShaped: false,
      overSplit: false,
      pageCount: 0,
    });
  });

  it('reports not text-shaped for a scanned card deck so it routes to the image-pair path', async () => {
    const front =
      'Pharmacology term and a full definition spelled out clearly here.';
    const back =
      'The matching answer side, also spelled out at a similar length here.';
    const pages = Array.from({ length: 228 }, (_, i) => ({
      text: i % 2 === 0 ? front : back,
      imagePaintCount: 1,
    }));
    const totalChars = pages.reduce((sum, p) => sum + p.text.length, 0);
    mockExtract.mockResolvedValue({
      pages,
      pageCount: 228,
      avgCharsPerPage: totalChars / 228,
      isDrmLocked: false,
      needsCredential: false,
    });

    const result = await convertPdfTextToHtmlAuto(
      Buffer.from('x'),
      'cards.pdf'
    );

    expect(result.isTextShaped).toBe(false);
    expect(result.cardCount).toBe(0);
    expect(result.html).toBe('');
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it('reports text-shaped with zero cards when no heading structure exists', async () => {
    const longLine =
      'Every line in this export is a long flowing paragraph well over the heading limit.';
    mockExtract.mockResolvedValue({
      pages: Array.from({ length: 5 }, () => ({
        text: [longLine, longLine].join('\n'),
        imagePaintCount: 0,
      })),
      pageCount: 5,
      avgCharsPerPage: 320,
      isDrmLocked: false,
      needsCredential: false,
    });

    const result = await convertPdfTextToHtmlAuto(
      Buffer.from('x'),
      'prose.pdf'
    );

    expect(result.isTextShaped).toBe(true);
    expect(result.cardCount).toBe(0);
  });

  it('flags over-split output so the caller can fall back instead of shipping a card explosion', async () => {
    const pairsPerPage = 16;
    const pageText = Array.from({ length: pairsPerPage }, (_, i) =>
      [
        `Term ${i}`,
        'A body line that is comfortably longer than the tiny heading above it.',
      ].join('\n')
    ).join('\n');
    mockExtract.mockResolvedValue({
      pages: [
        { text: pageText, imagePaintCount: 0 },
        { text: pageText, imagePaintCount: 0 },
      ],
      pageCount: 2,
      avgCharsPerPage: pageText.length,
      isDrmLocked: false,
      needsCredential: false,
    });

    const result = await convertPdfTextToHtmlAuto(
      Buffer.from('x'),
      'dense.pdf'
    );

    expect(result.isTextShaped).toBe(true);
    expect(result.overSplit).toBe(true);
    expect(result.cardCount).toBe(pairsPerPage * 2);
    expect(result.pageCount).toBe(2);
    expect(result.html).toBe('');
  });

  it('reports overSplit false and the page count on a sane deck', async () => {
    mockExtract.mockResolvedValue({
      pages: textShapedPages(),
      pageCount: 5,
      avgCharsPerPage: 320,
      isDrmLocked: false,
      needsCredential: false,
    });

    const result = await convertPdfTextToHtmlAuto(Buffer.from('x'), 'bio.pdf');

    expect(result.overSplit).toBe(false);
    expect(result.pageCount).toBe(5);
    expect(result.cardCount).toBe(5);
  });
});
