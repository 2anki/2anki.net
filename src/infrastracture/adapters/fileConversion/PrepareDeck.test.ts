import { PrepareDeck, prepareDeckInfoOnly } from './PrepareDeck';
import CardOption from '../../../lib/parser/Settings/CardOption';

jest.mock('../../../lib/claude/ClaudeService', () => {
  const actual = jest.requireActual('../../../lib/claude/ClaudeService');
  return { ...actual, generateDeckInfo: jest.fn() };
});

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

jest.mock('./convertDocxToHTML', () => ({
  convertDocxToHTML: jest.fn(),
}));

jest.mock(
  '../../../services/NotionService/helpers/downloadMediaOrSkip',
  () => ({
    downloadMediaOrSkip: jest.fn(),
  })
);

const {
  convertPdfTextToHtml,
  convertPdfTextToHtmlAuto,
} = require('./convertPdfTextToHtml');
const { convertPDFToImages } = require('./convertPDFToImages');
const {
  downloadMediaOrSkip,
} = require('../../../services/NotionService/helpers/downloadMediaOrSkip');

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

describe('PrepareDeck — Claude cross-file dedup (multi-file)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function deckWithCards(
    name: string,
    cards: Array<{ name: string; back: string }>
  ) {
    return [
      {
        name,
        image: '',
        style: null,
        id: 100000000000000,
        settings: { template: 'specialstyle' },
        cards: cards.map((c) => ({
          name: c.name,
          back: c.back,
          tags: [],
          cloze: false,
          number: 0,
          enableInput: false,
          answer: '',
          media: [],
        })),
      },
    ];
  }

  it('converts multiple files sequentially and threads earlier fronts into later prompts', async () => {
    const files = Array.from({ length: 3 }, (_, i) => ({
      name: `page-${i}.html`,
      contents: `<p>page ${i}</p>`,
    }));

    let inFlight = 0;
    let maxInFlight = 0;
    generateDeckInfo.mockImplementation(async (html: string) => {
      const index = Number(/page (\d+)/.exec(html)![1]);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight -= 1;
      return deckWithCards(`page-${index}`, [
        { name: `Fact from file ${index}`, back: `Answer ${index}` },
      ]);
    });

    const settings = makeSettings({
      'claude-ai-flashcards': 'true',
      'user-instructions': 'Focus on definitions',
    });
    await PrepareDeck({
      name: 'export.zip',
      files,
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(generateDeckInfo).toHaveBeenCalledTimes(3);
    expect(maxInFlight).toBe(1);

    const instructionsFor = (call: number) =>
      generateDeckInfo.mock.calls[call][2] as string;

    expect(instructionsFor(0)).toBe('Focus on definitions');
    expect(instructionsFor(0)).not.toContain('Do NOT repeat');

    expect(instructionsFor(1)).toContain('Focus on definitions');
    expect(instructionsFor(1)).toContain('Do NOT repeat any of these fronts');
    expect(instructionsFor(1)).toContain('Fact from file 0');

    expect(instructionsFor(2)).toContain('Fact from file 0');
    expect(instructionsFor(2)).toContain('Fact from file 1');
  });

  it('suppresses a later file card duplicating an earlier file, keeping sub-deck names', async () => {
    const files = [
      { name: 'chapter.html', contents: '<p>page 0</p>' },
      { name: 'transcript.html', contents: '<p>page 1</p>' },
    ];

    generateDeckInfo.mockImplementation(async (html: string) => {
      const index = Number(/page (\d+)/.exec(html)![1]);
      if (index === 0) {
        return deckWithCards('Chapter', [
          { name: 'What is glycolysis?', back: 'Glucose breakdown' },
          { name: 'Where does it occur?', back: 'Cytoplasm' },
        ]);
      }
      return deckWithCards('Transcript', [
        { name: '  WHAT is  glycolysis? ', back: '<p>Glucose breakdown</p>' },
        { name: 'Net ATP yield?', back: 'Two ATP' },
      ]);
    });

    const settings = makeSettings({ 'claude-ai-flashcards': 'true' });
    await PrepareDeck({
      name: 'export.zip',
      files,
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    });

    const configuredDecks = CustomExporterMock.mock.results[0].value.configure
      .mock.calls[0][0] as Array<{
      name: string;
      cards: Array<{ name: string }>;
    }>;
    expect(configuredDecks.map((d) => d.name)).toEqual([
      'Chapter',
      'Transcript',
    ]);
    const transcript = configuredDecks.find((d) => d.name === 'Transcript')!;
    expect(transcript.cards.map((c) => c.name)).toEqual(['Net ATP yield?']);
  });

  it('emits ai_conversion_completed with source_file_count and suppressed count', async () => {
    const files = [
      { name: 'a.html', contents: '<p>page 0</p>' },
      { name: 'b.html', contents: '<p>page 1</p>' },
    ];
    generateDeckInfo.mockImplementation(async (html: string) => {
      const index = Number(/page (\d+)/.exec(html)![1]);
      return deckWithCards(`deck-${index}`, [
        { name: 'Shared fact', back: 'Same answer' },
      ]);
    });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const trackMod = require('../../../services/events/track');
    const trackSpy = jest
      .spyOn(trackMod, 'track')
      .mockImplementation(() => undefined);

    try {
      await PrepareDeck({
        name: 'export.zip',
        files,
        settings: makeSettings({ 'claude-ai-flashcards': 'true' }),
        noLimits: true,
        workspace: makeWorkspace(),
        userId: 42,
      });

      const completed = trackSpy.mock.calls.find(
        (call: unknown[]) => call[0] === 'ai_conversion_completed'
      );
      expect(completed).toBeDefined();
      expect(
        (completed![1] as { props?: Record<string, unknown> }).props
      ).toMatchObject({
        source_file_count: 2,
        cross_file_duplicates_suppressed: 1,
      });
    } finally {
      trackSpy.mockRestore();
    }
  });

  it('leaves a single-file upload unchanged: no top-up, no cross-file event', async () => {
    generateDeckInfo.mockResolvedValueOnce(
      deckWithCards('Solo', [{ name: 'Only fact', back: 'Only answer' }])
    );

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const trackMod = require('../../../services/events/track');
    const trackSpy = jest
      .spyOn(trackMod, 'track')
      .mockImplementation(() => undefined);

    try {
      const settings = makeSettings({
        'claude-ai-flashcards': 'true',
        'user-instructions': 'Focus on definitions',
      });
      await PrepareDeck({
        name: 'solo.html',
        files: [{ name: 'solo.html', contents: '<p>page 0</p>' }],
        settings,
        noLimits: true,
        workspace: makeWorkspace(),
      });

      expect(generateDeckInfo).toHaveBeenCalledTimes(1);
      expect(generateDeckInfo.mock.calls[0][2]).toBe('Focus on definitions');
      const completed = trackSpy.mock.calls.find(
        (call: unknown[]) => call[0] === 'ai_conversion_completed'
      );
      expect(completed).toBeUndefined();
    } finally {
      trackSpy.mockRestore();
    }
  });

  it('uses a caller-threaded dedup state for a single-file conversion (loose multi-file path)', async () => {
    const { createCrossFileDedupState } = jest.requireActual(
      '../../../lib/claude/ClaudeService'
    );
    const crossFileDedup = createCrossFileDedupState();
    crossFileDedup.fronts.push('Fact from earlier file');
    crossFileDedup.seenKeys.add('recycled fact recycled answer');

    generateDeckInfo.mockResolvedValueOnce(
      deckWithCards('Loose', [
        { name: 'Recycled fact', back: 'Recycled answer' },
        { name: 'Brand new fact', back: 'New answer' },
      ])
    );

    const settings = makeSettings({ 'claude-ai-flashcards': 'true' });
    await PrepareDeck({
      name: 'second.html',
      files: [{ name: 'second.html', contents: '<p>page 0</p>' }],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
      crossFileDedup,
    });

    expect(generateDeckInfo).toHaveBeenCalledTimes(1);
    expect(generateDeckInfo.mock.calls[0][2]).toContain(
      'Fact from earlier file'
    );
    const configuredDecks = CustomExporterMock.mock.results[0].value.configure
      .mock.calls[0][0] as Array<{ cards: Array<{ name: string }> }>;
    expect(configuredDecks.flatMap((d) => d.cards.map((c) => c.name))).toEqual([
      'Brand new fact',
    ]);
    expect(crossFileDedup.suppressed).toBe(1);
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

describe('PrepareDeck — expired Notion image reporting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('propagates the expired Notion image count from the parser to the result', async () => {
    downloadMediaOrSkip.mockResolvedValue(null);
    const signedUrl =
      'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/diagram.png?X-Amz-Expires=3600&X-Amz-Signature=abc';
    const html = `<html><head><title>Deck</title></head><body><article>
<ul class="toggle"><li><details open="">
  <summary>Question</summary>
  <div><img src="${signedUrl}" /></div>
</details></li></ul>
</article></body></html>`;

    const result = await PrepareDeck({
      name: 'deck.html',
      files: [{ name: 'deck.html', contents: html }],
      settings: makeSettings(),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(result.droppedImageCount).toBe(1);
    expect(result.expiredNotionImageCount).toBe(1);
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

describe('PrepareDeck — extracted PDF figures reach the Claude media list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes text-path figures as media and hands the converter an image loader', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce({
      html: '<p>card with figure</p>',
      cardCount: 2,
      isDrmLocked: false,
      needsCredential: false,
      droppedImageCount: 0,
      images: [
        {
          name: 'notes.pdf-images/img-001-000.png',
          contents: Buffer.from('fake-png'),
        },
      ],
      isTextShaped: true,
      overSplit: false,
      pageCount: 1,
    });
    generateDeckInfo.mockResolvedValueOnce([
      {
        name: 'PDF Deck',
        image: '',
        style: null,
        id: 1,
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
    ]);

    await PrepareDeck({
      name: 'notes.pdf',
      files: [{ name: 'notes.pdf', contents: Buffer.from('%PDF-1.4 fake') }],
      settings: makeSettings({ 'claude-ai-flashcards': 'true' }),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(convertPdfTextToHtmlAuto).toHaveBeenCalledWith(
      expect.any(Buffer),
      'notes.pdf',
      undefined,
      expect.any(Function)
    );
    expect(generateDeckInfo).toHaveBeenCalledTimes(1);
    const mediaFiles = generateDeckInfo.mock.calls[0][1];
    expect(mediaFiles).toContain('notes.pdf-images/img-001-000.png');
  });

  it('passes no image loader when the user turned embedded images off', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce({
      html: '<p>text only</p>',
      cardCount: 1,
      isDrmLocked: false,
      needsCredential: false,
      droppedImageCount: 3,
      images: [],
      isTextShaped: true,
      overSplit: false,
      pageCount: 1,
    });
    generateDeckInfo.mockResolvedValueOnce([]);

    await PrepareDeck({
      name: 'notes.pdf',
      files: [{ name: 'notes.pdf', contents: Buffer.from('%PDF-1.4 fake') }],
      settings: makeSettings({
        'claude-ai-flashcards': 'true',
        'embed-images': 'false',
      }),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(convertPdfTextToHtmlAuto).toHaveBeenCalledWith(
      expect.any(Buffer),
      'notes.pdf',
      undefined,
      undefined
    );
  });
});

describe('PrepareDeck — AI media matching (#3946)', () => {
  const { convertDocxToHTML } = require('./convertDocxToHTML');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('offers unclaimed zip images to the AI conversion', async () => {
    generateDeckInfo.mockResolvedValueOnce([]);

    await PrepareDeck({
      name: 'export.zip',
      files: [
        { name: 'Page.html', contents: '<p>Front</p>' },
        { name: 'images/photo.png', contents: Buffer.from('png-bytes') },
      ],
      settings: makeSettings({ 'claude-ai-flashcards': 'true' }),
      noLimits: true,
      workspace: makeWorkspace(),
    }).catch(() => {});

    expect(generateDeckInfo).toHaveBeenCalledTimes(1);
    const mediaArg = generateDeckInfo.mock.calls[0][1];
    expect(mediaArg).toContain('images/photo.png');
  });

  it('does not offer the original source files as media', async () => {
    generateDeckInfo.mockResolvedValueOnce([]);
    convertDocxToHTML.mockResolvedValueOnce('<p>docx text</p>');

    await PrepareDeck({
      name: 'notes.docx',
      files: [{ name: 'notes.docx', contents: Buffer.from('PK-docx') }],
      settings: makeSettings({ 'claude-ai-flashcards': 'true' }),
      noLimits: true,
      workspace: makeWorkspace(),
    }).catch(() => {});

    const mediaArg = generateDeckInfo.mock.calls[0][1];
    expect(mediaArg).not.toContain('notes.docx');
  });

  it('carries DOCX images written by the media sink into the AI conversion', async () => {
    generateDeckInfo.mockResolvedValueOnce([]);
    convertDocxToHTML.mockImplementationOnce(
      async (
        _contents: Buffer,
        sink: { write: (bytes: Buffer, contentType: string) => string }
      ) => {
        const name = sink.write(Buffer.from('img-bytes'), 'image/png');
        return `<p>docx text</p><img src="${name}" />`;
      }
    );

    await PrepareDeck({
      name: 'notes.docx',
      files: [{ name: 'notes.docx', contents: Buffer.from('PK-docx') }],
      settings: makeSettings({ 'claude-ai-flashcards': 'true' }),
      noLimits: true,
      workspace: makeWorkspace(),
    }).catch(() => {});

    expect(generateDeckInfo).toHaveBeenCalledTimes(1);
    const mediaArg = generateDeckInfo.mock.calls[0][1] as string[];
    expect(mediaArg.some((m: string) => m.endsWith('.png'))).toBe(true);
  });
});

describe('assembleParserFiles — both build paths share one file set', () => {
  const { assembleParserFiles } = require('./PrepareDeck');

  it('includes originals, converted HTML, and extracted figure images', () => {
    const original = { name: 'notes.pdf', contents: Buffer.from('%PDF') };
    const figure = { name: 'figure-1.png', contents: Buffer.from('png') };
    const converted = {
      name: 'notes.pdf.html',
      contents: Buffer.from('<p>card</p>'),
      extraFiles: [figure],
    };

    const all = assembleParserFiles([original], [converted]);

    expect(all.map((f: { name: string }) => f.name)).toEqual([
      'notes.pdf',
      'notes.pdf.html',
      'figure-1.png',
    ]);
  });

  it('handles converters that extracted nothing', () => {
    const original = { name: 'page.html', contents: Buffer.from('<p></p>') };

    const all = assembleParserFiles([original], []);

    expect(all).toEqual([original]);
  });
});
