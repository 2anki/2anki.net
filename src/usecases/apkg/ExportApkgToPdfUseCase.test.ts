import { vi, type Mocked } from 'vitest';
import ExportApkgToPdfUseCase, {
  CardLimitExceededError,
} from './ExportApkgToPdfUseCase';
import ApkgPreviewService from '../../services/ApkgPreviewService/ApkgPreviewService';
import PdfRenderService from '../../services/PdfRenderService';
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
      renderHtml: vi.fn(),
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
    pdfRenderService.renderHtml.mockResolvedValue(pdfBuffer);

    const result = await useCase.execute(Buffer.from('fake-apkg'));

    expect(result.pdf).toBe(pdfBuffer);
    expect(result.deckName).toBe('Test Deck');
    expect(result.cardCount).toBe(3);
    expect(pdfRenderService.renderHtml).toHaveBeenCalledTimes(1);
    const htmlArg = pdfRenderService.renderHtml.mock.calls[0][0];
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
    expect(pdfRenderService.renderHtml).not.toHaveBeenCalled();
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
    pdfRenderService.renderHtml.mockResolvedValue(Buffer.from('%PDF'));

    const result = await useCase.execute(Buffer.from('fake-apkg'));

    expect(result.pdf).toEqual(Buffer.from('%PDF'));
    const htmlArg = pdfRenderService.renderHtml.mock.calls[0][0];
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
    pdfRenderService.renderHtml.mockResolvedValue(Buffer.from('%PDF'));

    await useCase.execute(Buffer.from('fake-apkg'));

    const htmlArg = pdfRenderService.renderHtml.mock.calls[0][0];
    expect(htmlArg).toContain('<em>[audio: word.mp3]</em>');
    expect(htmlArg).not.toContain('[sound:');
  });

  it('inlines media as base64 data URIs when available', async () => {
    const parsed = makeParsed(1);
    parsed.mediaMap.set('photo.png', '0');
    parsed.mediaEntries.set('0', Buffer.from('fake-png-data'));

    const cardWithImage = makeCard(1);
    cardWithImage.front = '<img src="photo.png" />';

    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(1));
    previewService.getCardsPage.mockReturnValueOnce({
      cards: [cardWithImage],
      nextCursor: null,
      total: 1,
    });
    pdfRenderService.renderHtml.mockResolvedValue(Buffer.from('%PDF'));

    await useCase.execute(Buffer.from('fake-apkg'));

    const htmlArg = pdfRenderService.renderHtml.mock.calls[0][0];
    const expectedBase64 = Buffer.from('fake-png-data').toString('base64');
    expect(htmlArg).toContain(`data:image/png;base64,${expectedBase64}`);
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
    pdfRenderService.renderHtml.mockResolvedValue(Buffer.from('%PDF'));

    await useCase.execute(Buffer.from('fake-apkg'));

    const htmlArg: string = pdfRenderService.renderHtml.mock.calls[0][0];
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
    pdfRenderService.renderHtml.mockResolvedValue(Buffer.from('%PDF'));

    await useCase.execute(Buffer.from('fake-apkg'), false, {
      backgroundColor: '#1a2b3c',
      paperSize: 'A4',
      orientation: 'portrait',
      margins: 'normal',
    });

    const htmlArg: string = pdfRenderService.renderHtml.mock.calls[0][0];
    expect(htmlArg).toContain('background:#1a2b3c');
  });

  it('forwards print options to pdfRenderService.renderHtml', async () => {
    const parsed = makeParsed(1);
    const cards = [makeCard(1)];
    previewService.parse.mockResolvedValue(parsed);
    previewService.getMeta.mockReturnValue(makeMeta(1));
    previewService.getCardsPage.mockReturnValueOnce({
      cards,
      nextCursor: null,
      total: 1,
    });
    pdfRenderService.renderHtml.mockResolvedValue(Buffer.from('%PDF'));

    const options = {
      backgroundColor: '#ffffff',
      paperSize: 'Letter' as const,
      orientation: 'landscape' as const,
      margins: 'wide' as const,
    };
    await useCase.execute(Buffer.from('fake-apkg'), false, options);

    expect(pdfRenderService.renderHtml).toHaveBeenCalledWith(
      expect.any(String),
      options
    );
  });
});
