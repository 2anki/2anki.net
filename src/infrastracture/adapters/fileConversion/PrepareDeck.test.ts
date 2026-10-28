import { AI_FILE_CONCURRENCY } from '../../../lib/claude/aiFileConcurrency';
import { vi, type Mock, type MockInstance } from 'vitest';
import fsModule from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import {
  PrepareDeck,
  parserWarning,
  prepareDeckInfoOnly,
  conversionInvokesAi,
  assembleParserFiles,
} from './PrepareDeck';
import CardOption from '../../../lib/parser/Settings/CardOption';
import { mcpOptionsToCardSettings } from '../../../services/mcp/mcpOptionsToCardSettings';
import {
  AiCreditsExhaustedError,
  getAiBudgetStatus as getAiBudgetStatusImport,
} from '../../../lib/claude/aiSpendGuard';
import { AI_CREDITS_EXHAUSTED_WARNING_CODE } from '../../../lib/claude/aiCredits/uploadWarning';
import {
  AiCreditsTrippedWithSalvage,
  generateDeckInfo as generateDeckInfoImport,
} from '../../../lib/claude/ClaudeService';
import CustomExporterDefault from '../../../lib/parser/exporters/CustomExporter';
import {
  convertPdfTextToHtml as convertPdfTextToHtmlImport,
  convertPdfTextToHtmlAuto as convertPdfTextToHtmlAutoImport,
} from './convertPdfTextToHtml';
import {
  convertPDFToImages as convertPDFToImagesImport,
  renderPdfPageImages as renderPdfPageImagesImport,
} from './convertPDFToImages';
import { combineIntoHTML } from '../../../lib/pdf/combineIntoHTML';
import { convertDocxToHTML as convertDocxToHTMLImport } from './convertDocxToHTML';
import { extractPptxSourceUnits as extractPptxSourceUnitsImport } from '../../../lib/parser/sourceUnits/extractPptxSourceUnits';
import { parsePdfFallbackChoiceSentinel } from '../../../lib/pdf/pdfFallbackChoice';
import { downloadMediaOrSkip as downloadMediaOrSkipImport } from '../../../services/NotionService/helpers/downloadMediaOrSkip';
import * as trackModule from '../../../services/events/track';

vi.mock('../../../lib/claude/ClaudeService', async () => {
  const actual = await vi.importActual<
    typeof import('../../../lib/claude/ClaudeService')
  >('../../../lib/claude/ClaudeService');
  return { ...actual, generateDeckInfo: vi.fn() };
});

vi.mock('../../../lib/claude/aiSpendGuard', async () => {
  const actual = await vi.importActual<
    typeof import('../../../lib/claude/aiSpendGuard')
  >('../../../lib/claude/aiSpendGuard');
  return {
    ...actual,
    getAiBudgetStatus: vi
      .fn()
      .mockResolvedValue({ exhausted: false, balance: null }),
  };
});

vi.mock('../../../lib/parser/exporters/CustomExporter', () => {
  return {
    __esModule: true,
    default: vi.fn().mockImplementation(function () {
      return {
        configure: vi.fn(),
        save: vi.fn().mockResolvedValue(Buffer.from('fake-apkg')),
      };
    }),
  };
});

vi.mock('../../../lib/anki/getDeckFilename', () => ({
  __esModule: true,
  default: vi.fn((name: string) => `${name}.apkg`),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const mocked = {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    promises: {
      ...actual.promises,
      readFile: vi.fn().mockResolvedValue(Buffer.from('png-bytes')),
    },
  };
  return { ...mocked, default: mocked };
});

vi.mock('./convertPdfTextToHtml', () => ({
  convertPdfTextToHtml: vi.fn().mockResolvedValue({
    html: '<p>extracted text card</p>',
    cardCount: 3,
    isDrmLocked: false,
    needsCredential: false,
  }),
  convertPdfTextToHtmlAuto: vi.fn().mockResolvedValue({
    html: '',
    cardCount: 0,
    isDrmLocked: false,
    needsCredential: false,
    isTextShaped: false,
  }),
}));

vi.mock('./convertPDFToImages', () => ({
  convertPDFToImages: vi.fn().mockResolvedValue('<p>page image card</p>'),
  renderPdfPageImages: vi.fn().mockResolvedValue({
    imagePaths: [
      '/tmp/test-workspace/pdf-1/page-1.png',
      '/tmp/test-workspace/pdf-1/page-2.png',
    ],
    title: 'deck.pdf',
  }),
}));

vi.mock('./convertDocxToHTML', () => ({
  convertDocxToHTML: vi.fn(),
}));

vi.mock('../../../services/NotionService/helpers/downloadMediaOrSkip', () => ({
  downloadMediaOrSkip: vi.fn(),
}));

const convertPdfTextToHtml = convertPdfTextToHtmlImport as unknown as Mock;
const convertPdfTextToHtmlAuto =
  convertPdfTextToHtmlAutoImport as unknown as Mock;
const convertPDFToImages = convertPDFToImagesImport as unknown as Mock;
const renderPdfPageImages = renderPdfPageImagesImport as unknown as Mock;
const extractPptxSourceUnits = extractPptxSourceUnitsImport as unknown as Mock;

vi.mock('./ConvertPPTToPDF', () => ({
  convertPPTToPDF: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 slides')),
}));

vi.mock('../../../lib/parser/sourceUnits/extractPptxSourceUnits', () => ({
  extractPptxSourceUnits: vi.fn().mockReturnValue([]),
}));

vi.mock('../../../services/events/track', () => ({
  track: vi.fn(),
}));

const downloadMediaOrSkip = downloadMediaOrSkipImport as unknown as Mock;
const generateDeckInfo = generateDeckInfoImport as unknown as Mock;
const getAiBudgetStatus = getAiBudgetStatusImport as unknown as Mock;
const CustomExporterMock = CustomExporterDefault as unknown as Mock;

function makeSettings(overrides: Record<string, string> = {}): CardOption {
  return new CardOption({ ...CardOption.LoadDefaultOptions(), ...overrides });
}

function makeWorkspace() {
  return { location: '/tmp/test-workspace' } as any;
}

describe('PrepareDeck — Claude AI flashcards branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(result?.name).toContain('My Deck');
    expect(result?.apkg).toEqual(Buffer.from('fake-apkg'));
  });

  it('falls back to the standard parser for an anonymous pass holder past their allowance', async () => {
    getAiBudgetStatus.mockResolvedValueOnce({ exhausted: true, balance: null });

    const settings = makeSettings({ 'claude-ai-flashcards': 'true' });
    const result = await PrepareDeck({
      name: 'test.html',
      files: [{ name: 'test.html', contents: '<p>Front</p>' }],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
      anonymousPassId: 7,
    });

    expect(getAiBudgetStatus).toHaveBeenCalledWith({
      userId: null,
      anonymousPassId: 7,
    });
    expect(generateDeckInfo).not.toHaveBeenCalled();
    expect(result?.warning).toBe(AI_CREDITS_EXHAUSTED_WARNING_CODE);
  });

  it('never fails when the credit guard trips mid-run; ships the produced cards with the warning', async () => {
    const deckArray = [
      {
        name: 'Covered Deck',
        image: '',
        style: null,
        id: 123456789012345,
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
    generateDeckInfo.mockImplementation(async (html: string) => {
      if (html.includes('two')) {
        throw new AiCreditsExhaustedError();
      }
      return deckArray;
    });

    const settings = makeSettings({ 'claude-ai-flashcards': 'true' });
    const result = await PrepareDeck({
      name: 'one.html',
      files: [
        { name: 'one.html', contents: '<p>one</p>' },
        { name: 'two.html', contents: '<p>two</p>' },
      ],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(result).toBeDefined();
    expect(result?.warning).toBe(AI_CREDITS_EXHAUSTED_WARNING_CODE);
    expect(result?.cardCount).toBeGreaterThanOrEqual(1);
  });

  it('falls back to the parser (not a crash) when a single-file AI conversion produces no cards', async () => {
    generateDeckInfo.mockRejectedValue(new AiCreditsExhaustedError());

    const html = `<html><head><title>Notes</title></head>
<body><article class="page sans"><header><h1 class="page-title">Notes</h1></header><div class="page-body">
<ul class="toggle"><li><details open=""><summary>What is glycolysis?</summary>
<p>Glucose breakdown</p></details></li></ul>
</div></article></body></html>`;

    const settings = makeSettings({ 'claude-ai-flashcards': 'true' });
    const result = await PrepareDeck({
      name: 'notes.html',
      files: [{ name: 'notes.html', contents: html }],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(result).toBeDefined();
    expect(result?.engine).toBe('parser');
    expect(result?.warning).toBe(AI_CREDITS_EXHAUSTED_WARNING_CODE);
    expect(result?.cardCount).toBeGreaterThanOrEqual(1);
  });

  it('does not invoke ClaudeService when noLimits is false', async () => {
    const settings = makeSettings({ 'claude-ai-flashcards': 'true' });

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
    vi.clearAllMocks();
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

  it('converts files side by side and threads finished fronts into later prompts', async () => {
    const fileCount = AI_FILE_CONCURRENCY + 2;
    const files = Array.from({ length: fileCount }, (_, i) => ({
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

    expect(generateDeckInfo).toHaveBeenCalledTimes(fileCount);
    expect(maxInFlight).toBe(AI_FILE_CONCURRENCY);

    const instructionsFor = (call: number) =>
      generateDeckInfo.mock.calls[call][2] as string;

    expect(instructionsFor(0)).toBe('Focus on definitions');
    expect(instructionsFor(AI_FILE_CONCURRENCY - 1)).not.toContain(
      'Do NOT repeat'
    );

    const lastCall = instructionsFor(fileCount - 1);
    expect(lastCall).toContain('Focus on definitions');
    expect(lastCall).toContain('Do NOT repeat any of these fronts');
    expect(lastCall).toContain('Fact from file 0');
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

    const trackMod = trackModule;
    const trackSpy = vi
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
        requestId: 'req-0f1e2d3c',
      });

      const generateOptions = generateDeckInfo.mock.calls.map(
        (call: unknown[]) => call[7]
      );
      expect(generateOptions.length).toBeGreaterThan(0);
      for (const options of generateOptions) {
        expect(options).toMatchObject({
          userId: 42,
          requestId: 'req-0f1e2d3c',
        });
      }

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

    const trackMod = trackModule;
    const trackSpy = vi
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
    const { createCrossFileDedupState, cardFingerprint } =
      await vi.importActual<typeof import('../../../lib/claude/ClaudeService')>(
        '../../../lib/claude/ClaudeService'
      );
    const crossFileDedup = createCrossFileDedupState();
    crossFileDedup.fronts.push('Fact from earlier file');
    crossFileDedup.seenKeys.add(
      cardFingerprint({ name: 'Recycled fact', back: 'Recycled answer' })
    );

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

  it('returns no deck (no exporter) when a threaded file is fully covered by earlier files', async () => {
    const { createCrossFileDedupState, cardFingerprint } =
      await vi.importActual<typeof import('../../../lib/claude/ClaudeService')>(
        '../../../lib/claude/ClaudeService'
      );
    const crossFileDedup = createCrossFileDedupState();
    crossFileDedup.seenKeys.add(
      cardFingerprint({ name: 'Only fact', back: 'Only answer' })
    );

    generateDeckInfo.mockResolvedValueOnce(
      deckWithCards('Duplicate', [{ name: 'Only fact', back: 'Only answer' }])
    );

    const result = await PrepareDeck({
      name: 'dupe.html',
      files: [{ name: 'dupe.html', contents: '<p>page 0</p>' }],
      settings: makeSettings({ 'claude-ai-flashcards': 'true' }),
      noLimits: true,
      workspace: makeWorkspace(),
      crossFileDedup,
    });

    expect(result).toBeUndefined();
    expect(CustomExporterMock).not.toHaveBeenCalled();
    expect(crossFileDedup.suppressed).toBe(1);
  });

  it("does not treat a sibling file's suppression as its own when it made no cards", async () => {
    const { createCrossFileDedupState, cardFingerprint } =
      await vi.importActual<typeof import('../../../lib/claude/ClaudeService')>(
        '../../../lib/claude/ClaudeService'
      );
    const crossFileDedup = createCrossFileDedupState();
    crossFileDedup.seenKeys.add(
      cardFingerprint({ name: 'Known fact', back: 'Known answer' })
    );

    let releaseEmpty: () => void = () => {};
    const emptyMayFinish = new Promise<void>((resolve) => {
      releaseEmpty = resolve;
    });
    generateDeckInfo.mockImplementation(async (html: string) => {
      if (html.includes('empty page')) {
        await emptyMayFinish;
        return [];
      }
      releaseEmpty();
      return deckWithCards('Sibling', [
        { name: 'Known fact', back: 'Known answer' },
      ]);
    });

    const settings = makeSettings({ 'claude-ai-flashcards': 'true' });
    const [empty] = await Promise.all([
      PrepareDeck({
        name: 'empty.html',
        files: [{ name: 'empty.html', contents: '<p>empty page</p>' }],
        settings,
        noLimits: true,
        workspace: makeWorkspace(),
        crossFileDedup,
      }),
      PrepareDeck({
        name: 'sibling.html',
        files: [{ name: 'sibling.html', contents: '<p>sibling page</p>' }],
        settings,
        noLimits: true,
        workspace: makeWorkspace(),
        crossFileDedup,
      }),
    ]);

    expect(crossFileDedup.suppressed).toBe(1);
    expect(empty?.engine).toBe('parser');
  });

  it('drops the duplicate whichever file finishes first', async () => {
    generateDeckInfo.mockImplementation(async (html: string) => {
      if (html.includes('page 0')) {
        await new Promise((r) => setTimeout(r, 15));
      }
      return deckWithCards('Shared', [{ name: 'Same fact', back: 'Same' }]);
    });

    await PrepareDeck({
      name: 'export.zip',
      files: [
        { name: 'a.html', contents: '<p>page 0</p>' },
        { name: 'b.html', contents: '<p>page 1</p>' },
      ],
      settings: makeSettings({ 'claude-ai-flashcards': 'true' }),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    const configuredDecks = CustomExporterMock.mock.results[0].value.configure
      .mock.calls[0][0] as Array<{ cards: Array<{ name: string }> }>;
    expect(configuredDecks.flatMap((d) => d.cards)).toHaveLength(1);
  });

  it('does not start queued files after one file fails', async () => {
    const files = Array.from({ length: AI_FILE_CONCURRENCY + 2 }, (_, i) => ({
      name: `page-${i}.html`,
      contents: `<p>page ${i}</p>`,
    }));
    generateDeckInfo.mockRejectedValue(new Error('Claude is down'));

    await expect(
      PrepareDeck({
        name: 'export.zip',
        files,
        settings: makeSettings({ 'claude-ai-flashcards': 'true' }),
        noLimits: true,
        workspace: makeWorkspace(),
      })
    ).rejects.toThrow();

    expect(generateDeckInfo).toHaveBeenCalledTimes(AI_FILE_CONCURRENCY);
  });

  it('falls back to the standard parser when a single upload gets no AI cards and nothing was suppressed', async () => {
    const { createCrossFileDedupState } = await vi.importActual<
      typeof import('../../../lib/claude/ClaudeService')
    >('../../../lib/claude/ClaudeService');
    const crossFileDedup = createCrossFileDedupState();
    generateDeckInfo.mockResolvedValueOnce([]);

    const result = await PrepareDeck({
      name: 'notes.html',
      files: [{ name: 'notes.html', contents: '<p>Some notes</p>' }],
      settings: makeSettings({ 'claude-ai-flashcards': 'true' }),
      noLimits: true,
      workspace: makeWorkspace(),
      crossFileDedup,
    });

    expect(result?.engine).toBe('parser');
    expect(crossFileDedup.suppressed).toBe(0);
  });

  it('sends a plain-text upload to Claude', async () => {
    generateDeckInfo.mockResolvedValueOnce(
      deckWithCards('Text Deck', [{ name: 'Front', back: 'Back' }])
    );

    const result = await PrepareDeck({
      name: 'lecture.txt',
      files: [{ name: 'lecture.txt', contents: 'Mitosis has four phases.' }],
      settings: makeSettings({ 'claude-ai-flashcards': 'true' }),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(generateDeckInfo).toHaveBeenCalledTimes(1);
    expect(generateDeckInfo.mock.calls[0][0]).toContain(
      'Mitosis has four phases.'
    );
    expect(result?.engine).toBe('claude');
  });
});

describe('PrepareDeck — PDF text-vs-image gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('threads the PDF page count onto the parser result for telemetry', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce({
      html: '<ul class="toggle"><li><details><summary>Q1</summary><p>A1</p></details></li></ul>',
      cardCount: 1,
      isDrmLocked: false,
      needsCredential: false,
      isTextShaped: true,
      pageCount: 18,
    });

    const result = await PrepareDeck({
      name: 'notes.pdf',
      files: [{ name: 'notes.pdf', contents: Buffer.from('%PDF-1.4 fake') }],
      settings: makeSettings(),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(result?.pdfPageCount).toBe(18);
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

  it('falls back to page images when pdf-extract-text would explode into cards', async () => {
    convertPdfTextToHtml.mockResolvedValueOnce({
      html: '',
      cardCount: 400,
      isDrmLocked: false,
      needsCredential: false,
      overSplit: true,
    });

    await runPdf(makeSettings({ 'pdf-extract-text': 'true' }));

    expect(convertPdfTextToHtml).toHaveBeenCalledTimes(1);
    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
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

describe('PrepareDeck — page pairs wins over AI conversion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function pdfDeckInfo() {
    return [
      {
        name: 'AI Deck',
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

  function runPdf(settings: CardOption) {
    return PrepareDeck({
      name: 'cards.pdf',
      files: [{ name: 'cards.pdf', contents: Buffer.from('%PDF-1.4 fake') }],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    });
  }

  it('builds page-pair image cards without calling Claude when every file is a PDF', async () => {
    const result = await runPdf(
      makeSettings({ 'pdf-page-pairs': 'true', 'claude-ai-flashcards': 'true' })
    );

    expect(generateDeckInfo).not.toHaveBeenCalled();
    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
    expect(result?.engine).toBe('parser');
  });

  it('still sends a mixed markdown + PDF upload to Claude', async () => {
    generateDeckInfo.mockResolvedValue(pdfDeckInfo());

    await PrepareDeck({
      name: 'export.zip',
      files: [
        { name: 'notes.md', contents: '# Mitosis\n- phases: four' },
        { name: 'cards.pdf', contents: Buffer.from('%PDF-1.4 fake') },
      ],
      settings: makeSettings({
        'pdf-page-pairs': 'true',
        'claude-ai-flashcards': 'true',
      }),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(generateDeckInfo).toHaveBeenCalled();
  });

  it('still sends a non-PDF upload to Claude when page pairs is on', async () => {
    generateDeckInfo.mockResolvedValue(pdfDeckInfo());

    await PrepareDeck({
      name: 'notes.md',
      files: [{ name: 'notes.md', contents: '# Mitosis' }],
      settings: makeSettings({
        'pdf-page-pairs': 'true',
        'claude-ai-flashcards': 'true',
      }),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(generateDeckInfo).toHaveBeenCalledTimes(1);
  });

  it('turns a four-page PDF into two page-pair cards via the parser', async () => {
    convertPDFToImages.mockResolvedValueOnce(
      combineIntoHTML(
        [
          '/tmp/test-workspace/pdf-1/page-1.png',
          '/tmp/test-workspace/pdf-1/page-2.png',
          '/tmp/test-workspace/pdf-1/page-3.png',
          '/tmp/test-workspace/pdf-1/page-4.png',
        ],
        'cards.pdf',
        '/tmp/test-workspace'
      )
    );

    const result = await runPdf(
      makeSettings({
        'pdf-page-pairs': 'true',
        'claude-ai-flashcards': 'true',
        'embed-images': 'false',
      })
    );

    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
    expect(result?.engine).toBe('parser');
    expect(result?.cardCount).toBe(2);
  });

  it('ignores zip junk so an all-PDF zip still skips Claude', async () => {
    generateDeckInfo.mockResolvedValue(pdfDeckInfo());

    const result = await PrepareDeck({
      name: 'cards.zip',
      files: [
        { name: 'cards.pdf', contents: Buffer.from('%PDF-1.4 fake') },
        { name: '.DS_Store', contents: Buffer.from('junk') },
        { name: '__MACOSX/._cards.pdf', contents: Buffer.from('junk') },
      ],
      settings: makeSettings({
        'pdf-page-pairs': 'true',
        'claude-ai-flashcards': 'true',
      }),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(generateDeckInfo).not.toHaveBeenCalled();
    expect(result?.engine).toBe('parser');
  });

  it('still sends a PDF + PPTX zip to Claude', async () => {
    generateDeckInfo.mockResolvedValue(pdfDeckInfo());

    await PrepareDeck({
      name: 'bundle.zip',
      files: [
        { name: 'cards.pdf', contents: Buffer.from('%PDF-1.4 fake') },
        { name: 'slides.pptx', contents: Buffer.from('PK slides') },
      ],
      settings: makeSettings({
        'pdf-page-pairs': 'true',
        'claude-ai-flashcards': 'true',
      }),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(generateDeckInfo).toHaveBeenCalled();
  });

  it('still sends a PDF + PNG zip to Claude', async () => {
    generateDeckInfo.mockResolvedValue(pdfDeckInfo());

    await PrepareDeck({
      name: 'bundle.zip',
      files: [
        { name: 'cards.pdf', contents: Buffer.from('%PDF-1.4 fake') },
        { name: 'figure.png', contents: Buffer.from('png-bytes') },
      ],
      settings: makeSettings({
        'pdf-page-pairs': 'true',
        'claude-ai-flashcards': 'true',
      }),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(generateDeckInfo).toHaveBeenCalled();
  });
});

describe('PrepareDeck — Claude PDF dropped-image reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(result?.droppedImageCount).toBe(0);
  });

  it('reports the scanned page-image count as dropped when images are off', async () => {
    convertPDFToImages.mockResolvedValueOnce(
      '<img src="p1.png" /><img src="p2.png" />'
    );
    generateDeckInfo.mockResolvedValueOnce(claudeDeck());

    const result = await runClaudePdf(
      makeSettings({ 'claude-ai-flashcards': 'true', 'embed-images': 'false' })
    );

    expect(result?.droppedImageCount).toBe(2);
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
    expect(result?.droppedImageCount).toBe(4);
  });

  it('threads the PDF page count onto the Claude result for telemetry', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce({
      html: '<p>auto text card</p>',
      cardCount: 5,
      isDrmLocked: false,
      needsCredential: false,
      isTextShaped: true,
      pageCount: 37,
    });
    generateDeckInfo.mockResolvedValueOnce(claudeDeck());

    const result = await runClaudePdf(
      makeSettings({ 'claude-ai-flashcards': 'true' })
    );

    expect(result?.pdfPageCount).toBe(37);
  });
});

describe('PrepareDeck — expired Notion image reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(result?.droppedImageCount).toBe(1);
    expect(result?.expiredNotionImageCount).toBe(1);
  });

  it('reports the plain-text fallback image count when the main parse finds no cards', async () => {
    const html = `<html><head><title>Deck</title></head><body>
<details><ul><li>Capital of France - Paris</li><li>Largest planet - Jupiter</li></ul></details>
<img src="a.png" /><img src="b.png" />
</body></html>`;

    const result = await PrepareDeck({
      name: 'deck.html',
      files: [{ name: 'deck.html', contents: html }],
      settings: makeSettings(),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(result?.cardCount).toBeGreaterThan(0);
    expect(result?.droppedImageCount).toBe(2);
    expect(result?.plainTextFallbackImageCount).toBe(2);
  });
});

describe('PrepareDeck — duplicate-name dedup', () => {
  let infoSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
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
        extensions: { pdf: 1 },
        sample: [expect.stringMatching(/^pdf:[0-9a-f]{8}$/)],
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
    vi.clearAllMocks();
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
    vi.clearAllMocks();
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
  const convertDocxToHTML = convertDocxToHTMLImport as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
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

describe('PrepareDeck — a PDF with no usable text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const noText = {
    html: '',
    cardCount: 0,
    isDrmLocked: false,
    needsCredential: false,
    isTextShaped: false,
    pageCount: 12,
  };

  function runPdf(settings: CardOption) {
    return PrepareDeck({
      name: 'scan.pdf',
      files: [{ name: 'scan.pdf', contents: Buffer.from('%PDF-1.4 fake') }],
      settings,
      noLimits: true,
      workspace: makeWorkspace(),
    });
  }

  it('stops and asks which cards to make when the upload page asks', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce(noText);

    const error = await runPdf(makeSettings({ 'pdf-fallback': 'ask' })).catch(
      (e: unknown) => e
    );

    expect(parsePdfFallbackChoiceSentinel((error as Error).message)).toEqual({
      reason: 'no_text',
      pageCount: 12,
    });
    expect(convertPDFToImages).not.toHaveBeenCalled();
  });

  it.each([
    ['locked', { isDrmLocked: true }],
    ['over_split', { isTextShaped: true, cardCount: 40, overSplit: true }],
  ])('says why it is asking: %s', async (reason, extra) => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce({ ...noText, ...extra });

    const error = await runPdf(makeSettings({ 'pdf-fallback': 'ask' })).catch(
      (e: unknown) => e
    );

    expect(
      parsePdfFallbackChoiceSentinel((error as Error).message)?.reason
    ).toBe(reason);
  });

  it('pairs pages and names that in the result when nothing is said', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce(noText);

    const result = await runPdf(makeSettings()).catch(() => undefined);

    expect(convertPDFToImages).toHaveBeenCalledWith(
      expect.objectContaining({ pageMode: 'pairs' })
    );
    expect(result?.pdfFallbackMode).toBe('pairs');
  });

  it('makes one card per page when that is the choice, and names it', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce(noText);

    const result = await runPdf(
      makeSettings({ 'pdf-fallback': 'single' })
    ).catch(() => undefined);

    expect(convertPDFToImages).toHaveBeenCalledWith(
      expect.objectContaining({ pageMode: 'single' })
    );
    expect(result?.pdfFallbackMode).toBe('single');
  });

  it('never asks about a PDF that has text', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce({
      html: '<p>auto text card</p>',
      cardCount: 5,
      isDrmLocked: false,
      needsCredential: false,
      isTextShaped: true,
    });

    const result = await runPdf(makeSettings({ 'pdf-fallback': 'ask' })).catch(
      () => undefined
    );

    expect(convertPDFToImages).not.toHaveBeenCalled();
    expect(result?.pdfFallbackMode).toBeUndefined();
  });

  function runPassHolderPdf(claudeAIFlashcards: 'true' | 'false') {
    return PrepareDeck({
      name: 'slides.pdf',
      files: [{ name: 'slides.pdf', contents: Buffer.from('%PDF-1.4 fake') }],
      settings: makeSettings({
        'pdf-fallback': 'pairs',
        'claude-ai-flashcards': claudeAIFlashcards,
      }),
      noLimits: true,
      anonymousPassId: 7,
      workspace: makeWorkspace(),
    });
  }

  it('names the page images for a pass holder with AI off', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce(noText);

    const result = await runPassHolderPdf('false');

    expect(generateDeckInfo).not.toHaveBeenCalled();
    expect(result?.engine).toBe('parser');
    expect(result?.pdfFallbackMode).toBe('pairs');
  });

  it('names no page images on a deck Claude wrote for a pass holder with AI on', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce(noText);
    generateDeckInfo.mockResolvedValueOnce([
      {
        name: 'Slides',
        image: '',
        style: null,
        id: 100000000000001,
        settings: { template: 'specialstyle' },
        cards: [
          {
            name: 'What does the first slide define?',
            back: 'Osmosis',
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

    const result = await runPassHolderPdf('true');

    expect(result?.engine).toBe('claude');
    expect(result?.pdfFallbackMode).toBeUndefined();
  });

  it('names the page images that ship when the AI credits run out before Claude writes a card', async () => {
    convertPdfTextToHtmlAuto.mockResolvedValueOnce(noText);
    generateDeckInfo.mockRejectedValueOnce(new AiCreditsTrippedWithSalvage([]));

    const result = await runPassHolderPdf('true');

    expect(generateDeckInfo).toHaveBeenCalledTimes(1);
    expect(result?.engine).toBe('parser');
    expect(result?.pdfFallbackMode).toBe('pairs');
    expect(result?.warning).toBe(AI_CREDITS_EXHAUSTED_WARNING_CODE);
  });
});

describe('PrepareDeck — Word variants', () => {
  const convertDocxToHTML = convertDocxToHTMLImport as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    convertDocxToHTML.mockResolvedValue('<ul><li>Term: definition</li></ul>');
  });

  it('reads a Word template (.dotx) with the .docx reader', async () => {
    const contents = Buffer.from('PK-dotx');

    await PrepareDeck({
      name: 'template.dotx',
      files: [{ name: 'template.dotx', contents }],
      settings: makeSettings({}),
      noLimits: true,
      workspace: makeWorkspace(),
    }).catch(() => {});

    expect(convertDocxToHTML.mock.calls[0][0]).toEqual(contents);
  });
});

describe('assembleParserFiles — both build paths share one file set', () => {
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

describe('parserWarning', () => {
  it('reports stray cloze markup as a coded count', () => {
    expect(parserWarning({ usedHeuristic: false, strayClozeCount: 3 })).toBe(
      'stray-cloze:3'
    );
  });

  it('lets the markdown heuristic outrank stray cloze markup', () => {
    expect(parserWarning({ usedHeuristic: true, strayClozeCount: 3 })).toBe(
      'markdown-heuristic'
    );
  });

  it('is silent when nothing happened', () => {
    expect(
      parserWarning({ usedHeuristic: false, strayClozeCount: 0 })
    ).toBeUndefined();
  });
});

describe('conversionInvokesAi', () => {
  const withToggle = (key: string) => makeSettings({ [key]: 'true' });
  const file = (name: string) => ({ name, contents: 'x' });

  it('is true when claudeAIFlashcards is on for any file type', () => {
    expect(
      conversionInvokesAi(withToggle('claude-ai-flashcards'), [
        file('notes.md'),
      ])
    ).toBe(true);
  });

  it('ignores the retired vertex-ai-pdf-questions key on a PDF upload', () => {
    expect(
      conversionInvokesAi(withToggle('vertex-ai-pdf-questions'), [
        file('lecture.pdf'),
      ])
    ).toBe(false);
  });

  it('is false for an html upload when only the image toggle is on', () => {
    expect(
      conversionInvokesAi(withToggle('image-quiz-html-to-anki'), [
        file('page.html'),
      ])
    ).toBe(false);
  });

  it('is true when the image toggle is on and the upload has an image', () => {
    expect(
      conversionInvokesAi(withToggle('image-quiz-html-to-anki'), [
        file('scan.png'),
      ])
    ).toBe(true);
  });

  it('is false when no AI toggle is set', () => {
    expect(conversionInvokesAi(makeSettings(), [file('notes.md')])).toBe(false);
  });

  it('is false when page pairs is on and every file is a PDF, even with Claude on', () => {
    expect(
      conversionInvokesAi(
        makeSettings({
          'claude-ai-flashcards': 'true',
          'pdf-page-pairs': 'true',
        }),
        [file('cards.pdf')]
      )
    ).toBe(false);
  });

  it('is true for a non-PDF upload even when page pairs and Claude are both on', () => {
    expect(
      conversionInvokesAi(
        makeSettings({
          'claude-ai-flashcards': 'true',
          'pdf-page-pairs': 'true',
        }),
        [file('notes.md')]
      )
    ).toBe(true);
  });

  it('is true for a mixed upload with page pairs and Claude on', () => {
    expect(
      conversionInvokesAi(
        makeSettings({
          'claude-ai-flashcards': 'true',
          'pdf-page-pairs': 'true',
        }),
        [file('notes.md'), file('cards.pdf')]
      )
    ).toBe(true);
  });

  it('still invokes the image vision path when page pairs is on', () => {
    expect(
      conversionInvokesAi(
        makeSettings({
          'image-quiz-html-to-anki': 'true',
          'pdf-page-pairs': 'true',
        }),
        [file('scan.png')]
      )
    ).toBe(true);
  });

  it('is true for an all-PDF page-pairs upload when PDF processing is off', () => {
    expect(
      conversionInvokesAi(
        makeSettings({
          'claude-ai-flashcards': 'true',
          'pdf-page-pairs': 'true',
          'process-pdfs': 'false',
        }),
        [file('cards.pdf')]
      )
    ).toBe(true);
  });

  it('ignores zip junk when deciding an all-PDF page-pairs upload', () => {
    expect(
      conversionInvokesAi(
        makeSettings({
          'claude-ai-flashcards': 'true',
          'pdf-page-pairs': 'true',
        }),
        [file('cards.pdf'), file('.DS_Store'), file('__MACOSX/._cards.pdf')]
      )
    ).toBe(false);
  });

  it('keeps AI for a PDF + PPTX page-pairs upload', () => {
    expect(
      conversionInvokesAi(
        makeSettings({
          'claude-ai-flashcards': 'true',
          'pdf-page-pairs': 'true',
        }),
        [file('cards.pdf'), file('slides.pptx')]
      )
    ).toBe(true);
  });

  it('keeps AI for a PDF + PNG page-pairs upload', () => {
    expect(
      conversionInvokesAi(
        makeSettings({
          'claude-ai-flashcards': 'true',
          'pdf-page-pairs': 'true',
        }),
        [file('cards.pdf'), file('figure.png')]
      )
    ).toBe(true);
  });
});

describe('PrepareDeck — anonymous card limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function toggleDeck(cardCount: number): string {
    const toggles = Array.from(
      { length: cardCount },
      (_, i) =>
        `<ul class="toggle"><li><details open=""><summary>Question ${i + 1}</summary><p>Answer ${i + 1}</p></details></li></ul>`
    ).join('\n');
    return `<html><head><title>Deck</title></head><body><article class="page sans"><header><h1 class="page-title">Deck</h1></header><div class="page-body">${toggles}</div></article></body></html>`;
  }

  it('delivers the limit and reports the held-back remainder', async () => {
    const result = await PrepareDeck({
      name: 'deck.html',
      files: [{ name: 'deck.html', contents: toggleDeck(25) }],
      settings: makeSettings({ cherry: 'false' }),
      noLimits: false,
      workspace: makeWorkspace(),
      cardLimit: 21,
    });

    expect(result?.cardCount).toBe(21);
    expect(result?.cardsHeldBack).toBe(4);
  });

  it('holds nothing back when no limit is passed', async () => {
    const result = await PrepareDeck({
      name: 'deck.html',
      files: [{ name: 'deck.html', contents: toggleDeck(25) }],
      settings: makeSettings({ cherry: 'false' }),
      noLimits: false,
      workspace: makeWorkspace(),
    });

    expect(result?.cardCount).toBe(25);
    expect(result?.cardsHeldBack).toBe(0);
  });
});

describe('PrepareDeck — PowerPoint text-first cards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function runDeck(name: string) {
    return PrepareDeck({
      name,
      files: [{ name, contents: Buffer.from('PK fake pptx') }],
      settings: makeSettings(),
      noLimits: true,
      workspace: makeWorkspace(),
    }).catch(() => undefined);
  }

  it('builds one text card per slide when the slides carry text', async () => {
    extractPptxSourceUnits.mockReturnValueOnce([
      {
        id: 'slide-1',
        visibleText: 'Mitosis\nCell division',
        speakerNotes: '',
        role: 'title',
        title: 'Mitosis',
        paragraphs: ['Cell division'],
        chromeParagraphs: [],
        textWithChrome: ['Mitosis', 'Cell division'],
        hasPicture: false,
      },
      {
        id: 'slide-2',
        visibleText: 'Meiosis\nGametes',
        speakerNotes: '',
        role: 'title',
        title: 'Meiosis',
        paragraphs: ['Gametes'],
        chromeParagraphs: [],
        textWithChrome: ['Meiosis', 'Gametes'],
        hasPicture: false,
      },
    ]);

    await runDeck('lecture.pptx');

    expect(renderPdfPageImages).toHaveBeenCalledTimes(1);
    expect(convertPDFToImages).not.toHaveBeenCalled();
    expect(fsModule.promises.readFile).toHaveBeenCalledWith(
      '/tmp/test-workspace/pdf-1/page-1.png'
    );
    expect(fsModule.promises.readFile).toHaveBeenCalledWith(
      '/tmp/test-workspace/pdf-1/page-2.png'
    );
  });

  it('keeps the page-image path when no slide has any text', async () => {
    extractPptxSourceUnits.mockReturnValueOnce([
      {
        id: 'slide-1',
        visibleText: '',
        speakerNotes: '',
        role: 'image',
        title: '',
        paragraphs: [],
        chromeParagraphs: [],
        textWithChrome: [],
        hasPicture: true,
      },
    ]);

    await runDeck('photos.pptx');

    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
    expect(renderPdfPageImages).not.toHaveBeenCalled();
  });

  it('keeps one card per slide when the only slide text is the slide number and footer', async () => {
    extractPptxSourceUnits.mockReturnValueOnce([
      {
        id: 'slide-1',
        visibleText: '',
        speakerNotes: '',
        role: 'image',
        title: '',
        paragraphs: [],
        chromeParagraphs: ['Cell Biology', '1'],
        textWithChrome: ['Cell Biology', '1'],
        hasPicture: true,
      },
      {
        id: 'slide-2',
        visibleText: '',
        speakerNotes: '',
        role: 'image',
        title: '',
        paragraphs: [],
        chromeParagraphs: ['Cell Biology', '2'],
        textWithChrome: ['Cell Biology', '2'],
        hasPicture: true,
      },
    ]);

    await runDeck('diagrams.pptx');

    expect(renderPdfPageImages).toHaveBeenCalledTimes(1);
    expect(convertPDFToImages).not.toHaveBeenCalled();
  });

  it('falls back to the page-image path when the slide XML cannot be read', async () => {
    extractPptxSourceUnits.mockImplementationOnce(() => {
      throw new Error('invalid zip data');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await runDeck('renamed.pptx');
    } finally {
      warn.mockRestore();
    }

    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
    expect(renderPdfPageImages).not.toHaveBeenCalled();
  });

  it('keeps the page-image path for the binary .ppt format', async () => {
    await runDeck('old.ppt');

    expect(extractPptxSourceUnits).not.toHaveBeenCalled();
    expect(convertPDFToImages).toHaveBeenCalledTimes(1);
  });
});

describe('PrepareDeck — a .pptx read by the real slide extractor', () => {
  const NAMESPACES =
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const picture =
    '<p:pic><p:nvPicPr><p:cNvPr id="5" name="Diagram"/></p:nvPicPr></p:pic>';

  function textShape(placeholder: string, text: string): string {
    return `<p:sp><p:nvSpPr><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  }

  function slideNumber(n: string): string {
    return `<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:t>${n}</a:t></a:fld></a:p></p:txBody></p:sp>`;
  }

  const footer = textShape(
    '<p:ph type="ftr" sz="quarter" idx="11"/>',
    'Cell Biology'
  );

  function pptx(slides: string[][]): Buffer {
    return Buffer.from(
      zipSync(
        Object.fromEntries(
          slides.map((shapes, i) => [
            `ppt/slides/slide${i + 1}.xml`,
            strToU8(
              `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NAMESPACES}><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`
            ),
          ])
        )
      )
    );
  }

  const numberedLecture = pptx([
    [
      slideNumber('19'),
      textShape('', '03'),
      textShape('', 'Exocytosis'),
      textShape('', 'Ca2+ influx triggers fusion'),
      footer,
    ],
    [
      textShape('<p:ph type="title"/>', 'Mitosis'),
      textShape('<p:ph idx="1"/>', 'Prophase'),
      footer,
      slideNumber('20'),
    ],
  ]);

  const titleSlideAndFigures = pptx([
    [textShape('<p:ph type="ctrTitle"/>', 'Mitosis')],
    [picture, footer, slideNumber('2')],
    [picture, footer, slideNumber('3')],
  ]);

  const titleHoldingOnlyASlideNumber = `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:t>2</a:t></a:fld></a:p></p:txBody></p:sp>`;

  const figureSlides = pptx([
    [picture, footer, slideNumber('1')],
    [titleHoldingOnlyASlideNumber, picture],
  ]);

  function cardFronts(html: string): string[] {
    return [...html.matchAll(/<summary>(.*?)<\/summary>/gs)].map(
      (match) => match[1]
    );
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const actual = await vi.importActual<
      typeof import('../../../lib/parser/sourceUnits/extractPptxSourceUnits')
    >('../../../lib/parser/sourceUnits/extractPptxSourceUnits');
    extractPptxSourceUnits.mockImplementationOnce(
      actual.extractPptxSourceUnits
    );
  });

  it('hands Claude slide titles and first lines with words as card fronts, never a slide number', async () => {
    generateDeckInfo.mockResolvedValueOnce([
      {
        name: 'Cell Biology',
        image: '',
        style: null,
        id: 111222333444555,
        settings: { template: 'specialstyle' },
        cards: [
          {
            name: 'Exocytosis',
            back: 'Ca2+ influx triggers fusion',
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

    const result = await PrepareDeck({
      name: 'lecture.pptx',
      files: [{ name: 'lecture.pptx', contents: numberedLecture }],
      settings: makeSettings({ 'claude-ai-flashcards': 'true' }),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(result?.engine).toBe('claude');
    expect(generateDeckInfo).toHaveBeenCalledTimes(1);
    const html = generateDeckInfo.mock.calls[0][0] as string;
    expect(cardFronts(html)).toEqual(['Exocytosis', 'Mitosis']);
  });

  it('hands Claude slide image srcs that decode to the names of the pages it offers, whatever the upload is called', async () => {
    renderPdfPageImages.mockResolvedValueOnce({
      imagePaths: [
        '/tmp/test-workspace/pdf-1/Lecture%203.pdf-page1-1.png',
        '/tmp/test-workspace/pdf-1/Lecture%203.pdf-page2-2.png',
      ],
      title: 'Lecture%203.pdf',
    });
    generateDeckInfo.mockResolvedValueOnce([
      {
        name: 'Cell Biology',
        image: '',
        style: null,
        id: 111222333444555,
        settings: { template: 'specialstyle' },
        cards: [
          {
            name: 'Exocytosis',
            back: 'Ca2+ influx triggers fusion',
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
      name: 'Lecture%203.pptx',
      files: [{ name: 'Lecture%203.pptx', contents: numberedLecture }],
      settings: makeSettings({ 'claude-ai-flashcards': 'true' }),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    const [html, offered] = generateDeckInfo.mock.calls[0] as [
      string,
      string[],
    ];
    const srcs = [...html.matchAll(/<img src="([^"]+)"/g)].map((match) =>
      decodeURIComponent(match[1])
    );
    expect(srcs).toEqual([
      'pdf-1/Lecture%203.pdf-page1-1.png',
      'pdf-1/Lecture%203.pdf-page2-2.png',
    ]);
    expect(offered).toEqual(expect.arrayContaining(srcs));
  });

  it('delivers the slides that fit a card limit, fronted by a line with words, and holds back the rest', async () => {
    CustomExporterMock.mockImplementationOnce(function () {
      return {
        configure: vi.fn(),
        addMedia: vi.fn(),
        save: vi.fn().mockResolvedValue(Buffer.from('fake-apkg')),
      };
    });

    const result = await PrepareDeck({
      name: 'lecture.pptx',
      files: [{ name: 'lecture.pptx', contents: numberedLecture }],
      settings: makeSettings(),
      noLimits: false,
      workspace: makeWorkspace(),
      cardLimit: 1,
    });

    const fronts = result?.deck.flatMap((deck) =>
      deck.cards.map((card) => card.name.replaceAll(/<[^>]+>/g, ''))
    );
    expect(result?.cardCount).toBe(1);
    expect(result?.cardsHeldBack).toBe(1);
    expect(fronts).toEqual(['Exocytosis']);
  });

  it.each([
    {
      cloze: 'true',
      expected: [
        { front: 'Mitosis', back: '' },
        { front: 'Cell Biology', back: '2' },
        { front: 'Cell Biology', back: '3' },
      ],
    },
    {
      cloze: 'false',
      expected: [
        { front: 'Cell Biology', back: '2' },
        { front: 'Cell Biology', back: '3' },
      ],
    },
  ])(
    'makes the cards it made before chrome detection from a title slide and figure slides whose only text is the footer and slide number when slide images are off (cloze $cloze)',
    async ({ cloze, expected }) => {
      const result = await PrepareDeck({
        name: 'lecture.pptx',
        files: [{ name: 'lecture.pptx', contents: titleSlideAndFigures }],
        settings: makeSettings({ 'process-pdfs': 'false', cloze }),
        noLimits: true,
        workspace: makeWorkspace(),
      });

      const cards = result?.deck.flatMap((deck) =>
        deck.cards.map((card) => ({
          front: card.name.replaceAll(/<[^>]+>/g, '').trim(),
          back: card.back.replaceAll(/<[^>]+>/g, '').trim(),
        }))
      );
      expect(cards).toEqual(expected);
      expect(renderPdfPageImages).not.toHaveBeenCalled();
      expect(convertPDFToImages).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      embedding: 'embedded images are off',
      settings: () => makeSettings({ 'embed-images': 'false' }),
    },
    {
      embedding: 'the settings hold no embedImages value',
      settings: () => Object.assign(makeSettings(), { embedImages: undefined }),
    },
  ])(
    'makes the cards it made before chrome detection when $embedding, so no question is a slide image the deck never ships',
    async ({ settings }) => {
      const result = await PrepareDeck({
        name: 'figures.pptx',
        files: [{ name: 'figures.pptx', contents: figureSlides }],
        settings: settings(),
        noLimits: true,
        workspace: makeWorkspace(),
      });

      const cards = result?.deck.flatMap((deck) =>
        deck.cards.map((card) => ({
          front: card.name,
          back: card.back.trim(),
        }))
      );
      expect(renderPdfPageImages).toHaveBeenCalledTimes(1);
      expect(cards).toEqual([
        {
          front: "<div class='toggle'>Cell Biology</div>",
          back: '<ul><li>1</li></ul><img src="pdf-1/page-1.png">',
        },
        {
          front: "<div class='toggle'>2</div>",
          back: '<img src="pdf-1/page-2.png">',
        },
      ]);
    }
  );
});

describe('PrepareDeck — two-way cards from convert_to_deck options', () => {
  const twoWay = () =>
    makeSettings(mcpOptionsToCardSettings({ noteType: 'basic-reversed' }));

  it('builds a mirrored card for every CSV row', async () => {
    const result = await PrepareDeck({
      name: 'reversed-test.csv',
      files: [
        {
          name: 'reversed-test.csv',
          contents: Buffer.from(
            'front,back\n会う,あう — to meet (verb)\n青い,あおい — blue (adjective)\n'
          ),
        },
      ],
      settings: twoWay(),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(result?.cardCount).toBe(4);
    const cards = result?.deck.flatMap((deck) => deck.cards) ?? [];
    expect(cards.map((card) => [card.name, card.back])).toEqual([
      ['会う', 'あう — to meet (verb)'],
      ['青い', 'あおい — blue (adjective)'],
      ['あう — to meet (verb)', '会う'],
      ['あおい — blue (adjective)', '青い'],
    ]);
  });

  it('builds a mirrored card for every Markdown bullet pair', async () => {
    const result = await PrepareDeck({
      name: 'reversed-test.md',
      files: [
        {
          name: 'reversed-test.md',
          contents: '- 会う\n  - あう — to meet\n- 青い\n  - あおい — blue\n',
        },
      ],
      settings: twoWay(),
      noLimits: true,
      workspace: makeWorkspace(),
    });

    expect(result?.cardCount).toBe(4);
    const cards = result?.deck.flatMap((deck) => deck.cards) ?? [];
    const fronts = cards.map((card) => card.name);
    expect(fronts.filter((front) => front.includes('会う'))).toHaveLength(1);
    expect(cards.filter((card) => card.back.includes('会う'))).toHaveLength(1);
  });
});
