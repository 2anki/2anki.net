import { PrepareDeck, prepareDeckInfoOnly } from './PrepareDeck';
import CardOption from '../../../lib/parser/Settings/CardOption';

jest.mock('../../../lib/claude/ClaudeService', () => ({
  generateDeckInfo: jest.fn(),
}));

jest.mock('../../../lib/parser/exporters/CustomExporter', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      configure: jest.fn(),
      save: jest.fn().mockResolvedValue(Buffer.from('fake-apkg')),
    })),
  };
});

jest.mock('../../../lib/anki/getDeckFilename', () => ({
  __esModule: true,
  default: jest.fn((name: string) => `${name}.apkg`),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

jest.mock('./convertPdfTextToHtml', () => ({
  convertPdfTextToHtml: jest.fn().mockResolvedValue({
    html: '<p>extracted text card</p>',
    cardCount: 3,
    isDrmLocked: false,
    needsCredential: false,
  }),
  convertPdfTextToHtmlAuto: jest.fn().mockResolvedValue({
    html: '',
    cardCount: 0,
    isDrmLocked: false,
    needsCredential: false,
    isTextShaped: false,
  }),
}));

jest.mock('./convertPDFToImages', () => ({
  convertPDFToImages: jest.fn().mockResolvedValue('<p>page image card</p>'),
}));

const {
  convertPdfTextToHtml,
  convertPdfTextToHtmlAuto,
} = require('./convertPdfTextToHtml');
const { convertPDFToImages } = require('./convertPDFToImages');

const { generateDeckInfo } = require('../../../lib/claude/ClaudeService');
const CustomExporterMock =
  require('../../../lib/parser/exporters/CustomExporter').default;

function makeSettings(overrides: Record<string, string> = {}): CardOption {
  return new CardOption({ ...CardOption.LoadDefaultOptions(), ...overrides });
}

function makeWorkspace() {
  return { location: '/tmp/test-workspace' } as any;
}

describe('PrepareDeck — Claude AI flashcards branch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invokes ClaudeService when claudeAIFlashcards is true and user is paying', async () => {
    const deckArray = [
      {
        name: 'My Deck',
        image: '',
        style: null,
        id: 111222333444555,
        settings: { template: 'specialstyle' },
        cards: [
          {
            name: 'Front',
            back: 'Back',
            tags: [],
            cloze: false,
            number: 0,
            enableInput: false,
            answer: '',
            media: [],
          },
        ],
      },
    ];

    generateDeckInfo.mockResolvedValueOnce(deckArray);

    const settings = makeSettings({ 'claude-ai-flashcards': 'true' });
    const result = await PrepareDeck({
      name: 'test.html',
      files: [{ name: 'test.html', contents: '<p>Front</p>' }],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(generateDeckInfo).toHaveBeenCalledTimes(1);
    expect(result.name).toContain('My Deck');
    expect(result.apkg).toEqual(Buffer.from('fake-apkg'));
  });

  it('does not invoke ClaudeService when noLimits is false', async () => {
    const settings = makeSettings({ 'claude-ai-flashcards': 'true' });

    jest.mock('../../../lib/parser/DeckParser', () => ({
      DeckParser: jest.fn().mockImplementation(() => ({
        totalCardCount: jest.fn().mockReturnValue(0),
        processFirstFile: jest.fn(),
        tryExperimental: jest
          .fn()
          .mockResolvedValue(Buffer.from('regular-apkg')),
        name: 'test',
        payload: [],
      })),
    }));

    await PrepareDeck({
      name: 'test.html',
      files: [{ name: 'test.html', contents: '<p>Front</p>' }],
      settings,
      noLimits: false,
      workspace: makeWorkspace(),
    }).catch(() => {});

    expect(generateDeckInfo).not.toHaveBeenCalled();
  });

  it('does not invoke ClaudeService when claudeAIFlashcards is false', async () => {
    const settings = makeSettings({ 'claude-ai-flashcards': 'false' });

    await PrepareDeck({
      name: 'test.html',
      files: [{ name: 'test.html', contents: '<p>Front</p>' }],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    }).catch(() => {});

    expect(generateDeckInfo).not.toHaveBeenCalled();
  });
});

describe('PrepareDeck — HTML generation concurrency window', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function deckArrayFor(label: string) {
    return [
      {
        name: label,
        image: '',
        style: null,
        id: 100000000000000,
        settings: { template: 'specialstyle' },
        cards: [
          {
            name: label,
            back: 'Back',
            tags: [],
            cloze: false,
            number: 0,
            enableInput: false,
            answer: '',
            media: [],
          },
        ],
      },
    ];
  }

  it('keeps at most 3 calls in flight, slides the window, and returns results in source order', async () => {
    const fileCount = 7;
    const files = Array.from({ length: fileCount }, (_, i) => ({
      name: `page-${i}.html`,
      contents: `<p>page ${i}</p>`,
    }));

    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers: Array<(value: unknown) => void> = [];
    const callOrder: number[] = [];

    generateDeckInfo.mockImplementation((html: string) => {
      const index = Number(/page (\d+)/.exec(html)![1]);
      callOrder.push(index);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) => {
        resolvers[index] = (value) => {
          inFlight -= 1;
          resolve(value);
        };
      });
    });

    const settings = makeSettings({ 'claude-ai-flashcards': 'true' });
    const prepared = PrepareDeck({
      name: 'export.zip',
      files,
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    });

    const flush = () => new Promise((r) => setImmediate(r));
    const waitUntil = async (predicate: () => boolean, label: string) => {
      for (let i = 0; i < 2000; i++) {
        if (predicate()) return;
        await flush();
      }
      throw new Error(`waitUntil exhausted 2000 flushes waiting for ${label}`);
    };

    await waitUntil(() => callOrder.length >= 3, 'first 3 calls in flight');

    expect(inFlight).toBe(3);

    const resolveOrder = [2, 0, 1, 5, 3, 6, 4];
    for (const index of resolveOrder) {
      await waitUntil(
        () => Boolean(resolvers[index]),
        `resolver for page-${index}`
      );
      resolvers[index](deckArrayFor(`page-${index}`));
      await flush();
    }

    const result = await prepared;

    expect(generateDeckInfo).toHaveBeenCalledTimes(fileCount);
    expect(maxInFlight).toBe(3);

    const configuredDecks = CustomExporterMock.mock.results[0].value.configure
      .mock.calls[0][0] as Array<{ name: string }>;
    expect(configuredDecks.map((d) => d.name)).toEqual([
      'page-0',
      'page-1',
      'page-2',
      'page-3',
      'page-4',
      'page-5',
      'page-6',
    ]);

    expect(result.cardCount).toBe(fileCount);
  });
});

describe('PrepareDeck — PDF text-vs-image gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function runPdf(settings: CardOption) {
    return PrepareDeck({
      name: 'notes.pdf',
      files: [{ name: 'notes.pdf', contents: Buffer.from('%PDF-1.4 fake') }],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    }).catch(() => undefined);
  }

  it('renders page images when auto-detection finds the PDF not text-shaped', async () => {
    expect(makeSettings().pdfExtractText).toBe(false);
    await runPdf(makeSettings());
    expect(convertPdfTextToHtmlAuto).toHaveBeenCalledTimes(1);
    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
    expect(convertPdfTextToHtml).not.toHaveBeenCalled();
  });

  it('uses heading-split text when auto-detection finds a text-shaped PDF', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce({
      html: '<p>auto text card</p>',
      cardCount: 5,
      isDrmLocked: false,
      needsCredential: false,
      isTextShaped: true,
    });

    await runPdf(makeSettings());

    expect(convertPdfTextToHtmlAuto).toHaveBeenCalledTimes(1);
    expect(convertPDFToImages).not.toHaveBeenCalled();
    expect(convertPdfTextToHtml).not.toHaveBeenCalled();
  });

  it('keeps page images when the text-shaped PDF yields no heading cards', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce({
      html: '',
      cardCount: 0,
      isDrmLocked: false,
      needsCredential: false,
      isTextShaped: true,
    });

    await runPdf(makeSettings());

    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
  });

  it('keeps page images for DRM-locked PDFs when the flag is unset', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce({
      html: '',
      cardCount: 0,
      isDrmLocked: true,
      needsCredential: false,
      isTextShaped: false,
    });

    await runPdf(makeSettings());

    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
  });

  it('throws the password sentinel when the auto path needs a credential', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce({
      html: '',
      cardCount: 0,
      isDrmLocked: false,
      needsCredential: true,
      isTextShaped: false,
    });

    await expect(
      PrepareDeck({
        name: 'notes.pdf',
        files: [{ name: 'notes.pdf', contents: Buffer.from('%PDF-1.4 fake') }],
        settings: makeSettings(),
        noLimits: true,
        workspace: makeWorkspace(),
      })
    ).rejects.toThrow('PDF_NEEDS_PASSWORD');
    expect(convertPDFToImages).not.toHaveBeenCalled();
  });

  it('uses extracted text when pdf-extract-text is on', async () => {
    expect(makeSettings({ 'pdf-extract-text': 'true' }).pdfExtractText).toBe(
      true
    );
    await runPdf(makeSettings({ 'pdf-extract-text': 'true' }));
    expect(convertPdfTextToHtml).toHaveBeenCalledTimes(1);
    expect(convertPdfTextToHtmlAuto).not.toHaveBeenCalled();
    expect(convertPDFToImages).not.toHaveBeenCalled();
  });

  it('routes straight to page images when pdf-page-pairs is on, skipping detection', async () => {
    expect(makeSettings({ 'pdf-page-pairs': 'true' }).pdfPagePairs).toBe(true);
    await runPdf(makeSettings({ 'pdf-page-pairs': 'true' }));
    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
    expect(convertPdfTextToHtmlAuto).not.toHaveBeenCalled();
    expect(convertPdfTextToHtml).not.toHaveBeenCalled();
  });

  it('lets page-pairs win over pdf-extract-text when both are on', async () => {
    await runPdf(
      makeSettings({ 'pdf-page-pairs': 'true', 'pdf-extract-text': 'true' })
    );
    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
    expect(convertPdfTextToHtml).not.toHaveBeenCalled();
    expect(convertPdfTextToHtmlAuto).not.toHaveBeenCalled();
  });
});

describe('PrepareDeck — Claude PDF dropped-image reporting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function claudeDeck() {
    return [
      {
        name: 'PDF Deck',
        image: '',
        style: null,
        id: 111222333444555,
        settings: { template: 'specialstyle' },
        cards: [
          {
            name: 'Front',
            back: 'Back',
            tags: [],
            cloze: false,
            number: 0,
            enableInput: false,
            answer: '',
            media: [],
          },
        ],
      },
    ];
  }

  function runClaudePdf(settings: CardOption) {
    return PrepareDeck({
      name: 'notes.pdf',
      files: [{ name: 'notes.pdf', contents: Buffer.from('%PDF-1.4 fake') }],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    });
  }

  it('mirrors embed-images into pdfImageFallback.attachPageImages (default on)', async () => {
    generateDeckInfo.mockResolvedValueOnce(claudeDeck());

    await runClaudePdf(makeSettings({ 'claude-ai-flashcards': 'true' }));

    expect(generateDeckInfo).toHaveBeenCalledTimes(1);
    const options = generateDeckInfo.mock.calls[0][7];
    expect(options.pdfImageFallback).toEqual({
      mediaBaseDir: '/tmp/test-workspace',
      attachPageImages: true,
    });
  });

  it('mirrors embed-images off into pdfImageFallback.attachPageImages', async () => {
    generateDeckInfo.mockResolvedValueOnce(claudeDeck());

    await runClaudePdf(
      makeSettings({ 'claude-ai-flashcards': 'true', 'embed-images': 'false' })
    );

    const options = generateDeckInfo.mock.calls[0][7];
    expect(options.pdfImageFallback.attachPageImages).toBe(false);
  });

  it('reports zero dropped images when scanned page images are embedded', async () => {
    generateDeckInfo.mockResolvedValueOnce(claudeDeck());

    const result = await runClaudePdf(
      makeSettings({ 'claude-ai-flashcards': 'true' })
    );

    expect(result.droppedImageCount).toBe(0);
  });

  it('reports the scanned page-image count as dropped when images are off', async () => {
    convertPDFToImages.mockResolvedValueOnce(
      '<img src="p1.png" /><img src="p2.png" />'
    );
    generateDeckInfo.mockResolvedValueOnce(claudeDeck());

    const result = await runClaudePdf(
      makeSettings({ 'claude-ai-flashcards': 'true', 'embed-images': 'false' })
    );

    expect(result.droppedImageCount).toBe(2);
  });

  it('reports the real painted-image count on a text-shaped Claude conversion', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce({
      html: '<p>auto text card</p>',
      cardCount: 5,
      isDrmLocked: false,
      needsCredential: false,
      droppedImageCount: 4,
      isTextShaped: true,
    });
    generateDeckInfo.mockResolvedValueOnce(claudeDeck());

    const result = await runClaudePdf(
      makeSettings({ 'claude-ai-flashcards': 'true' })
    );

    expect(convertPDFToImages).not.toHaveBeenCalled();
    expect(result.droppedImageCount).toBe(4);
  });
});

describe('PrepareDeck — duplicate-name dedup', () => {
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('collapses two same-named entries to a single received file', async () => {
    const settings = makeSettings();
    await PrepareDeck({
      name: 'anatomy.pdf',
      files: [
        { name: 'anatomy.pdf', contents: Buffer.from('%PDF-1.4 a') },
        { name: 'anatomy.pdf', contents: Buffer.from('%PDF-1.4 b') },
      ],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    }).catch(() => undefined);

    expect(infoSpy).toHaveBeenCalledWith(
      '[PrepareDeck] received',
      expect.objectContaining({
        count: 1,
        names: ['anatomy.pdf'],
        sources: ['anatomy.pdf'],
      })
    );
  });

  it('converts a same-named PDF once instead of fanning out two conversions', async () => {
    const settings = makeSettings();
    await PrepareDeck({
      name: 'anatomy.pdf',
      files: [
        { name: 'anatomy.pdf', contents: Buffer.from('%PDF-1.4 a') },
        { name: 'anatomy.pdf', contents: Buffer.from('%PDF-1.4 b') },
      ],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    }).catch(() => undefined);

    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct-named PDFs as separate conversions', async () => {
    const settings = makeSettings();
    await PrepareDeck({
      name: 'export.zip',
      files: [
        { name: 'anatomy.pdf', contents: Buffer.from('%PDF-1.4 a') },
        { name: 'histology.pdf', contents: Buffer.from('%PDF-1.4 b') },
      ],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    }).catch(() => undefined);

    expect(convertPDFToImages).toHaveBeenCalledTimes(2);
  });
});

describe('prepareDeckInfoOnly — duplicate-name dedup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('converts a same-named PDF once instead of fanning out two conversions', async () => {
    const settings = makeSettings();
    await prepareDeckInfoOnly(
      {
        name: 'anatomy.pdf',
        files: [
          { name: 'anatomy.pdf', contents: Buffer.from('%PDF-1.4 a') },
          { name: 'anatomy.pdf', contents: Buffer.from('%PDF-1.4 b') },
        ],
        settings,
        noLimits: true,
        workspace: makeWorkspace(),
      },
      makeWorkspace(),
      makeWorkspace()
    ).catch(() => undefined);

    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
  });

  it('keeps distinct-named PDFs as separate conversions', async () => {
    const settings = makeSettings();
    await prepareDeckInfoOnly(
      {
        name: 'export.zip',
        files: [
          { name: 'anatomy.pdf', contents: Buffer.from('%PDF-1.4 a') },
          { name: 'histology.pdf', contents: Buffer.from('%PDF-1.4 b') },
        ],
        settings,
        noLimits: true,
        workspace: makeWorkspace(),
      },
      makeWorkspace(),
      makeWorkspace()
    ).catch(() => undefined);

    expect(convertPDFToImages).toHaveBeenCalledTimes(2);
  });
});
