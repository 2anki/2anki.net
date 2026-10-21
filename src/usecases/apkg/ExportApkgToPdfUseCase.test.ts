import { vi, type Mocked } from 'vitest';
import ExportApkgToPdfUseCase, {
  CardLimitExceededError,
} from './ExportApkgToPdfUseCase';
import ApkgPreviewService from '../../services/ApkgPreviewService/ApkgPreviewService';
import PdfRenderService, {
  PdfRenderCrashedError,
} from '../../services/PdfRenderService';
import {
  RenderedCard,
  PreviewMeta,
} from '../../services/ApkgPreviewService/types';
import { ParsedApkg } from '../../services/ApkgPreviewService/ApkgPreviewService';

function makeCard(id: number): RenderedCard {
  return {
    id,
    ord: 0,
    templateName: 'Basic',
    deckName: 'Test Deck',
    deckPath: ['Test Deck'],
    noteTypeName: 'Basic',
    css: '.card { color: black; }',
    front: `<p>Question ${id}</p>`,
    back: `<p>Answer ${id}</p>`,
  };
}

function makeParsed(cardCount: number): ParsedApkg {
  return {
    collection: {
      noteTypes: new Map(),
      notes: new Map(),
      decks: new Map([[1, { id: 1, name: 'Test Deck' }]]),
      cards: Array.from({ length: cardCount }, (_, i) => ({
        id: i + 1,
        nid: i + 1,
        did: 1,
        ord: 0,
      })),
    },
    mediaMap: new Map(),
    mediaEntries: new Map(),
    parsedAt: Date.now(),
  };
}

function makeMeta(totalCards: number): PreviewMeta {
  return {
    totalCards,
    decks: [
      {
        id: 1,
        fullName: 'Test Deck',
        path: ['Test Deck'],
        cardCount: totalCards,
      },
    ],
  };
}

describe('ExportApkgToPdfUseCase', () => {
  let previewService: Mocked<ApkgPreviewService>;
  let pdfRenderService: Mocked<PdfRenderService>;
  let useCase: ExportApkgToPdfUseCase;

  beforeEach(() => {
    previewService = {
      parse: vi.fn(),
      getMeta: vi.fn(),
      getCardsPage: vi.fn(),
      getMediaEntry: vi.fn(),
    } as unknown as Mocked<ApkgPreviewService>;

    pdfRenderService = {
      renderDocument: vi.fn(),
      renderPreviewImage: vi.fn(),
    } as unknown as Mocked<PdfRenderService>;

    useCase = new ExportApkgToPdfUseCase(previewService, pdfRenderService);
  });

  it('produces a PDF buffer for a valid apkg', async () => {
    const parsed = makeParsed(3);
    const cards = [makeCard(1), makeCard(2), makeCard(3)];
    const pdfBuffer = Buffer.from('%PDF-fake');

    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(3));
    previewService.getCardsPage.mockReturnValueOnce({
      cards,
      nextCursor: null,
      total: 3,
    });
    pdfRenderService.renderDocument.mockResolvedValue(pdfBuffer);

    const result = await useCase.execute(Buffer.from('fake-apkg'));

    expect(result.pdf).toBe(pdfBuffer);
    expect(result.deckName).toBe('Test Deck');
    expect(result.cardCount).toBe(3);
    expect(pdfRenderService.renderDocument).toHaveBeenCalledTimes(1);
    const htmlArg = pdfRenderService.renderDocument.mock.calls[0][0].html;
    expect(htmlArg).toContain('Question 1');
    expect(htmlArg).toContain('Answer 3');
  });

  it('throws CardLimitExceededError for decks over 1000 cards', async () => {
    const parsed = makeParsed(1001);
    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(1001));

    await expect(useCase.execute(Buffer.from('fake-apkg'))).rejects.toThrow(
      CardLimitExceededError
    );
    await expect(useCase.execute(Buffer.from('fake-apkg'))).rejects.toThrow(
      /1001 cards/
    );
    expect(pdfRenderService.renderDocument).not.toHaveBeenCalled();
  });

  it('handles missing media gracefully', async () => {
    const parsed = makeParsed(1);
    const cardWithMissingImage = makeCard(1);
    cardWithMissingImage.front = '<p>Q</p><img src="missing.png" />';
    cardWithMissingImage.back = '<p>A</p>';

    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(1));
    previewService.getCardsPage.mockReturnValueOnce({
      cards: [cardWithMissingImage],
      nextCursor: null,
      total: 1,
    });
    pdfRenderService.renderDocument.mockResolvedValue(Buffer.from('%PDF'));

    const result = await useCase.execute(Buffer.from('fake-apkg'));

    expect(result.pdf).toEqual(Buffer.from('%PDF'));
    const htmlArg = pdfRenderService.renderDocument.mock.calls[0][0].html;
    expect(htmlArg).not.toContain('missing.png');
  });

  it('replaces sound tokens with italic text', async () => {
    const parsed = makeParsed(1);
    const cardWithAudio = makeCard(1);
    cardWithAudio.front = '<p>Listen: [sound:word.mp3]</p>';

    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(1));
    previewService.getCardsPage.mockReturnValueOnce({
      cards: [cardWithAudio],
      nextCursor: null,
      total: 1,
    });
    pdfRenderService.renderDocument.mockResolvedValue(Buffer.from('%PDF'));

    await useCase.execute(Buffer.from('fake-apkg'));

    const htmlArg = pdfRenderService.renderDocument.mock.calls[0][0].html;
    expect(htmlArg).toContain('<em>[audio: word.mp3]</em>');
    expect(htmlArg).not.toContain('[sound:');
  });

  it('hands media to the renderer as files instead of inlining base64', async () => {
    const parsed = makeParsed(2);
    parsed.mediaMap.set('photo.png', '0');
    parsed.mediaEntries.set('0', Buffer.from('fake-png-data'));

    const first = makeCard(1);
    first.front = '<img src="photo.png" />';
    const second = makeCard(2);
    second.front = '<img src="photo.png" />';

    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(2));
    previewService.getCardsPage.mockReturnValueOnce({
      cards: [first, second],
      nextCursor: null,
      total: 2,
    });
    pdfRenderService.renderDocument.mockResolvedValue(Buffer.from('%PDF'));

    await useCase.execute(Buffer.from('fake-apkg'));

    const doc = pdfRenderService.renderDocument.mock.calls[0][0];
    expect(doc.html).not.toContain('base64');
    expect(doc.html.match(/src="media-0\.png"/g)).toHaveLength(2);
    expect(doc.assets).toEqual(
      new Map([['media-0.png', Buffer.from('fake-png-data')]])
    );
  });

  it('turns a deck too big to hold as one HTML string into PdfRenderCrashedError', async () => {
    const parsed = makeParsed(1);
    const card = makeCard(1);
    Object.defineProperty(card, 'css', {
      get() {
        throw new RangeError('Invalid string length');
      },
    });
    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(1));
    previewService.getCardsPage.mockReturnValueOnce({
      cards: [card],
      nextCursor: null,
      total: 1,
    });

    await expect(
      useCase.execute(Buffer.from('fake-apkg'))
    ).rejects.toBeInstanceOf(PdfRenderCrashedError);
    expect(pdfRenderService.renderDocument).not.toHaveBeenCalled();
  });

  it('tags a render crash with the card count for failure analytics', async () => {
    const parsed = makeParsed(3);
    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(3));
    previewService.getCardsPage.mockReturnValueOnce({
      cards: [makeCard(1), makeCard(2), makeCard(3)],
      nextCursor: null,
      total: 3,
    });
    pdfRenderService.renderDocument.mockRejectedValue(
      new PdfRenderCrashedError()
    );

    await expect(
      useCase.execute(Buffer.from('fake-apkg'))
    ).rejects.toMatchObject({ name: 'PdfRenderCrashedError', cardCount: 3 });
  });

  it('uses white background by default', async () => {
    const parsed = makeParsed(1);
    const cards = [makeCard(1)];
    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(1));
    previewService.getCardsPage.mockReturnValueOnce({
      cards,
      nextCursor: null,
      total: 1,
    });
    pdfRenderService.renderDocument.mockResolvedValue(Buffer.from('%PDF'));

    await useCase.execute(Buffer.from('fake-apkg'));

    const htmlArg: string =
      pdfRenderService.renderDocument.mock.calls[0][0].html;
    expect(htmlArg).toContain('background:#ffffff');
  });

  it('applies custom backgroundColor to the generated HTML body', async () => {
    const parsed = makeParsed(1);
    const cards = [makeCard(1)];
    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(1));
    previewService.getCardsPage.mockReturnValueOnce({
      cards,
      nextCursor: null,
      total: 1,
    });
    pdfRenderService.renderDocument.mockResolvedValue(Buffer.from('%PDF'));

    await useCase.execute(Buffer.from('fake-apkg'), false, {
      backgroundColor: '#1a2b3c',
      paperSize: 'A4',
      orientation: 'portrait',
      margins: 'normal',
    });

    const htmlArg: string =
      pdfRenderService.renderDocument.mock.calls[0][0].html;
    expect(htmlArg).toContain('background:#1a2b3c');
  });

  it('forwards print options to pdfRenderService.renderDocument', async () => {
    const parsed = makeParsed(1);
    const cards = [makeCard(1)];
    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(1));
    previewService.getCardsPage.mockReturnValueOnce({
      cards,
      nextCursor: null,
      total: 1,
    });
    pdfRenderService.renderDocument.mockResolvedValue(Buffer.from('%PDF'));

    const options = {
      backgroundColor: '#ffffff',
      paperSize: 'Letter' as const,
      orientation: 'landscape' as const,
      margins: 'wide' as const,
    };
    await useCase.execute(Buffer.from('fake-apkg'), false, options);

    expect(pdfRenderService.renderDocument).toHaveBeenCalledWith(
      expect.objectContaining({ html: expect.any(String) }),
      options
    );
  });
});

describe('ExportApkgToPdfUseCase.preview', () => {
  let previewService: Mocked<ApkgPreviewService>;
  let pdfRenderService: Mocked<PdfRenderService>;
  let useCase: ExportApkgToPdfUseCase;

  beforeEach(() => {
    previewService = {
      parse: vi.fn(),
      getMeta: vi.fn(),
      getCardsPage: vi.fn(),
      getMediaEntry: vi.fn(),
    } as unknown as Mocked<ApkgPreviewService>;

    pdfRenderService = {
      renderDocument: vi.fn(),
      renderPreviewImage: vi.fn(),
    } as unknown as Mocked<PdfRenderService>;

    useCase = new ExportApkgToPdfUseCase(previewService, pdfRenderService);
  });

  it('renders the first 3 cards as a PNG without a card limit check', async () => {
    const parsed = makeParsed(1873);
    const image = Buffer.from('fake-png');
    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(1873));
    previewService.getCardsPage.mockReturnValueOnce({
      cards: [makeCard(1), makeCard(2), makeCard(3)],
      nextCursor: 3,
      total: 1873,
    });
    pdfRenderService.renderPreviewImage.mockResolvedValue(image);

    const result = await useCase.preview(
      Buffer.from('fake-apkg'),
      undefined,
      3
    );

    expect(result.image).toBe(image);
    expect(result.totalCards).toBe(1873);
    expect(result.previewedCards).toBe(3);
    expect(previewService.getCardsPage).toHaveBeenCalledWith(
      parsed,
      0,
      3,
      '',
      null,
      { print: true }
    );
    expect(pdfRenderService.renderPreviewImage).toHaveBeenCalledTimes(1);
    expect(pdfRenderService.renderDocument).not.toHaveBeenCalled();
  });

  it('previews every card when the deck has fewer than the limit', async () => {
    const parsed = makeParsed(2);
    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(2));
    previewService.getCardsPage.mockReturnValueOnce({
      cards: [makeCard(1), makeCard(2)],
      nextCursor: null,
      total: 2,
    });
    pdfRenderService.renderPreviewImage.mockResolvedValue(Buffer.from('png'));

    const result = await useCase.preview(
      Buffer.from('fake-apkg'),
      undefined,
      3
    );

    expect(result.totalCards).toBe(2);
    expect(result.previewedCards).toBe(2);
  });

  it('returns a null image and zero counts for an empty deck without rendering', async () => {
    const parsed = makeParsed(0);
    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue({ totalCards: 0, decks: [] });

    const result = await useCase.preview(
      Buffer.from('fake-apkg'),
      undefined,
      3
    );

    expect(result.image).toBeNull();
    expect(result.totalCards).toBe(0);
    expect(result.previewedCards).toBe(0);
    expect(pdfRenderService.renderPreviewImage).not.toHaveBeenCalled();
  });

  it('forwards the pdf options to renderPreviewImage', async () => {
    const parsed = makeParsed(1);
    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(1));
    previewService.getCardsPage.mockReturnValueOnce({
      cards: [makeCard(1)],
      nextCursor: null,
      total: 1,
    });
    pdfRenderService.renderPreviewImage.mockResolvedValue(Buffer.from('png'));

    const options = {
      backgroundColor: '#1a2b3c',
      paperSize: 'Letter' as const,
      orientation: 'landscape' as const,
      margins: 'wide' as const,
    };
    await useCase.preview(Buffer.from('fake-apkg'), options, 3);

    const [doc, forwarded] = pdfRenderService.renderPreviewImage.mock.calls[0];
    expect(doc.html).toContain('background:#1a2b3c');
    expect(forwarded).toEqual(options);
  });
});
