import { AI_FILE_CONCURRENCY } from '../../lib/claude/aiFileConcurrency';
import { vi, type MockInstance } from 'vitest';
import fs from 'fs';
import { strToU8, zipSync } from 'fflate';
import * as trackModule from '../../services/events/track';
import {
  getFileContents,
  runUploadGenerationInWorker,
  systemErrorOf,
  countAiContentFiles,
  shouldDedupeAcrossFiles,
  shouldDedupeAcrossDecks,
} from './worker';
import { UploadedFile } from '../../lib/storage/types';
import CardOption from '../../lib/parser/Settings/CardOption';
import Workspace from '../../lib/parser/WorkSpace';
import { UploadGenerationTask } from './uploadGenerationTypes';
import {
  absorbFileIntoCrossFileDedup,
  cardFingerprint,
  CrossFileDedupState,
} from '../../lib/claude/ClaudeService';
import { PrepareDeck } from '../../infrastracture/adapters/fileConversion/PrepareDeck';
import { applyPdfPageRange } from '../../infrastracture/adapters/fileConversion/applyPdfPageRange';
import { getPackagesFromZip } from './getPackagesFromZip';
import { getEventsSink } from '../../services/events/eventsSinkInstance';
import { createWorkerTerminationError } from '../../lib/workerTermination';

vi.mock('fs');
vi.mock('../../lib/parser/WorkSpace');
vi.mock('../../infrastracture/adapters/fileConversion/PrepareDeck', () => ({
  PrepareDeck: vi.fn(),
}));
vi.mock(
  '../../infrastracture/adapters/fileConversion/applyPdfPageRange',
  () => ({
    applyPdfPageRange: vi.fn(async (files: unknown) => files),
  })
);
vi.mock('../../lib/pythonWorkerBudget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/pythonWorkerBudget')>()),
  resolvePerWorkerPythonCap: () => 2,
}));
vi.mock('./getPackagesFromZip', () => ({
  getPackagesFromZip: vi.fn(),
}));

const mockFs = vi.mocked(fs);
const mockPrepareDeck = vi.mocked(PrepareDeck);
const mockApplyPdfPageRange = vi.mocked(applyPdfPageRange);
const mockGetPackagesFromZip = vi.mocked(getPackagesFromZip);

function makeClaudeSettings(): CardOption {
  return new CardOption({
    ...CardOption.LoadDefaultOptions(),
    'claude-ai-flashcards': 'true',
  });
}

function oneCardDeck(name: string, front: string, back: string) {
  return {
    name,
    image: '',
    style: null as null | string,
    id: 1,
    settings: {},
    cards: [
      {
        name: front,
        back,
        tags: [],
        cloze: false,
        number: 0,
        enableInput: false,
        answer: '',
        media: [],
      },
    ],
  };
}

function makeFile(overrides: Partial<UploadedFile>): UploadedFile {
  return {
    fieldname: 'file',
    originalname: 'test.html',
    encoding: '7bit',
    mimetype: 'text/html',
    size: 0,
    stream: null as never,
    destination: '',
    filename: 'test.html',
    path: '',
    buffer: undefined as never,
    key: 'test-key',
    ...overrides,
  };
}

describe('getFileContents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('dwell time logging', () => {
    let infoSpy: MockInstance;

    beforeEach(() => {
      infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    });

    afterEach(() => {
      infoSpy.mockRestore();
    });

    it('logs dwellMs >= 0 when reading from buffer', () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);

      const content = Buffer.from('hello');
      const file = makeFile({ path: '', buffer: content });

      getFileContents(file, 900);

      expect(infoSpy).toHaveBeenCalledWith(
        '[upload] tempfile dwell',
        expect.objectContaining({
          dwellMs: expect.any(Number),
          mode: 'buffer',
          fileSizeBytes: 5,
        })
      );
      const logged = infoSpy.mock.calls[0][1] as { dwellMs: number };
      expect(logged.dwellMs).toBeGreaterThanOrEqual(0);

      vi.useRealTimers();
    });

    it('logs dwellMs >= 0 when reading from disk', () => {
      vi.useFakeTimers();
      vi.setSystemTime(2000);

      const content = Buffer.from('disk content');
      const file = makeFile({ path: '/tmp/upload-exists' });
      mockFs.existsSync = vi.fn().mockReturnValue(true);
      mockFs.readFileSync = vi.fn().mockReturnValue(content);

      getFileContents(file, 1500);

      expect(infoSpy).toHaveBeenCalledWith(
        '[upload] tempfile dwell',
        expect.objectContaining({
          dwellMs: expect.any(Number),
          mode: 'disk',
          fileSizeBytes: 12,
        })
      );
      const logged = infoSpy.mock.calls[0][1] as { dwellMs: number };
      expect(logged.dwellMs).toBeGreaterThanOrEqual(0);

      vi.useRealTimers();
    });
  });

  it('throws when path is set to a missing file and buffer is undefined', () => {
    const file = makeFile({
      path: '/tmp/upload-gone',
      buffer: undefined as never,
    });
    mockFs.existsSync = vi.fn().mockReturnValue(false);

    expect(() => getFileContents(file)).toThrow(
      'Uploaded file is no longer available on disk and has no buffer fallback'
    );
  });

  it('falls back to the snapshot buffer when the disk file was reaped', () => {
    // The receipt-time snapshot (GetUploadHandler) populates file.buffer while
    // the disk path is still set. When the temp file is reaped before the
    // worker runs, getFileContents must serve the captured bytes, not throw.
    const snapshot = Buffer.from('snapshot bytes');
    const file = makeFile({ path: '/tmp/upload-reaped', buffer: snapshot });
    mockFs.existsSync = vi.fn().mockReturnValue(false);

    const result = getFileContents(file);

    expect(result).toEqual(snapshot);
  });

  it('throws when neither path nor buffer is present', () => {
    const file = makeFile({ path: '', buffer: undefined as never });

    expect(() => getFileContents(file)).toThrow(
      'Uploaded file has neither a path nor a buffer'
    );
  });

  it('returns buffer contents when path is absent and buffer is present', () => {
    const content = Buffer.from('hello');
    const file = makeFile({ path: '', buffer: content });

    const result = getFileContents(file);

    expect(result).toEqual(content);
  });

  it('returns file contents when path exists on disk', () => {
    const content = Buffer.from('disk content');
    const file = makeFile({ path: '/tmp/upload-exists' });
    mockFs.existsSync = vi.fn().mockReturnValue(true);
    mockFs.readFileSync = vi.fn().mockReturnValue(content);

    const result = getFileContents(file);

    expect(result).toEqual(content);
  });
});

describe('runUploadGenerationInWorker', () => {
  function makeTask(file: UploadedFile): UploadGenerationTask {
    return {
      paying: false,
      files: [file],
      settings: new CardOption({}),
      workspace: {} as Workspace,
      enqueuedAt: Date.now(),
      userId: null,
    };
  }

  let infoSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('returns a failure result with a non-empty message and error name when generation throws', async () => {
    const file = makeFile({
      originalname: 'existing.apkg',
      filename: 'existing.apkg',
      path: '',
      buffer: Buffer.from('not really a deck'),
    });

    const result = await runUploadGenerationInWorker(makeTask(file));

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected a failure result');
    }
    expect(result.error.message).toContain('already an Anki deck');
    expect(result.error.name).toBe('Error');
  });

  it('sends the stack of the error that was thrown back with the failure', async () => {
    const file = makeFile({
      originalname: 'existing.apkg',
      filename: 'existing.apkg',
      path: '',
      buffer: Buffer.from('not really a deck'),
    });

    const result = await runUploadGenerationInWorker(makeTask(file));

    if (result.ok) {
      throw new Error('expected a failure result');
    }
    expect(result.error.stack).toMatch(/already an Anki deck[\s\S]*\n\s+at /);
  });

  it('keeps the code and errno of a filesystem error', () => {
    const enoent = Object.assign(
      new Error("ENOENT: no such file or directory, open '/srv/ws/x.html'"),
      { code: 'ENOENT', errno: -2, syscall: 'open' }
    );

    expect(systemErrorOf(enoent)).toEqual({ code: 'ENOENT', errno: -2 });
  });

  it.each([
    [
      'a coded upload error',
      Object.assign(new Error('x'), { code: 'docx_parse_failed' }),
    ],
    ['a plain error', new Error('x')],
    ['a non-error value', 'boom'],
    [
      'a dropped connection, which would read as a client abort',
      Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
        errno: -54,
      }),
    ],
  ])('leaves out system error fields for %s', (_label, value) => {
    expect(systemErrorOf(value)).toBeUndefined();
  });

  it('sends the code and errno of a filesystem error thrown during generation', async () => {
    const enoent = Object.assign(
      new Error("ENOENT: no such file or directory, open '/srv/ws/x.html'"),
      { code: 'ENOENT', errno: -2, syscall: 'open' }
    );
    const file = makeFile({
      originalname: 'notes.html',
      filename: 'notes.html',
    });
    Object.defineProperty(file, 'buffer', {
      get() {
        throw enoent;
      },
    });

    const result = await runUploadGenerationInWorker(makeTask(file));

    if (result.ok) {
      throw new Error('expected a failure result');
    }
    expect(result.error.systemError).toEqual({ code: 'ENOENT', errno: -2 });
  });

  it('sends no system error fields for an ordinary thrown error', async () => {
    const file = makeFile({
      originalname: 'existing.apkg',
      filename: 'existing.apkg',
      path: '',
      buffer: Buffer.from('not really a deck'),
    });

    const result = await runUploadGenerationInWorker(makeTask(file));

    if (result.ok) {
      throw new Error('expected a failure result');
    }
    expect(result.error.systemError).toBeUndefined();
  });

  it('drains recorded spend even when generation throws', async () => {
    const flushSpy = vi
      .spyOn(getEventsSink(), 'flushDurable')
      .mockResolvedValue(undefined);
    const file = makeFile({
      originalname: 'existing.apkg',
      filename: 'existing.apkg',
      path: '',
      buffer: Buffer.from('not really a deck'),
    });

    const result = await runUploadGenerationInWorker(makeTask(file));

    expect(result.ok).toBe(false);
    expect(flushSpy).toHaveBeenCalledTimes(1);
    flushSpy.mockRestore();
  });

  it('returns a success result with empty packages for an unsupported file type', async () => {
    const file = makeFile({
      originalname: 'notes.unsupported',
      filename: 'notes.unsupported',
      key: 'notes.unsupported',
      path: '',
      buffer: Buffer.from('plain text'),
    });

    const result = await runUploadGenerationInWorker(makeTask(file));

    expect(result).toEqual({ ok: true, packages: [], warnings: [] });
  });

  it('forwards an onProgress callback through to generation', async () => {
    const onProgress = vi.fn();
    const file = makeFile({
      originalname: 'notes.unsupported',
      filename: 'notes.unsupported',
      key: 'notes.unsupported',
      path: '',
      buffer: Buffer.from('plain text'),
    });

    const result = await runUploadGenerationInWorker(
      makeTask(file),
      onProgress
    );

    expect(result.ok).toBe(true);
  });

  it('converts an uploaded PDF even when PDFs inside ZIPs are switched off', async () => {
    const file = makeFile({
      originalname: 'lecture.pdf',
      filename: 'lecture.pdf',
      key: 'lecture.pdf',
      path: '',
      buffer: Buffer.from('%PDF-1.4'),
    });
    const task = {
      ...makeTask(file),
      settings: new CardOption({ 'process-pdfs': 'false' }),
    };

    await runUploadGenerationInWorker(task);

    expect(mockPrepareDeck).toHaveBeenCalledTimes(1);
    expect(mockPrepareDeck.mock.calls[0][0].settings.processPDFs).toBe(true);
  });

  it('converts a slide deck that arrives without an extension as a PowerPoint', async () => {
    const slides = Buffer.from(
      zipSync({ 'ppt/presentation.xml': strToU8('<p:presentation/>') })
    );
    const file = makeFile({
      originalname: 'lecture',
      filename: 'lecture',
      key: 'lecture',
      path: '',
      buffer: slides,
    });

    await runUploadGenerationInWorker(makeTask(file));

    expect(mockPrepareDeck).toHaveBeenCalledTimes(1);
    expect(mockPrepareDeck.mock.calls[0][0]).toMatchObject({
      name: 'lecture.pptx',
      files: [{ name: 'lecture.pptx', contents: slides }],
    });
  });

  describe('page range scope', () => {
    const makePdf = (name: string) =>
      makeFile({
        originalname: name,
        filename: name,
        key: name,
        path: '',
        buffer: Buffer.from('%PDF-1.4'),
      });

    const rangeTask = (files: UploadedFile[]): UploadGenerationTask => ({
      paying: false,
      files,
      settings: new CardOption({ 'pdf-page-range': '2-3' }),
      workspace: {} as Workspace,
      enqueuedAt: Date.now(),
      userId: null,
    });

    beforeEach(() => {
      mockPrepareDeck.mockResolvedValue(undefined);
      mockGetPackagesFromZip.mockResolvedValue({ packages: [], warnings: [] });
    });

    it('applies the range to a single uploaded PDF', async () => {
      const rangedFiles = [
        { name: 'lecture.pdf', contents: Buffer.from('%PDF-ranged') },
      ];
      mockApplyPdfPageRange.mockResolvedValueOnce(rangedFiles);

      await runUploadGenerationInWorker(rangeTask([makePdf('lecture.pdf')]));

      expect(mockApplyPdfPageRange).toHaveBeenCalledTimes(1);
      expect(mockApplyPdfPageRange.mock.calls[0][1]).toBe('2-3');
      expect(mockApplyPdfPageRange.mock.calls[0][4]).toBe('lecture.pdf');
      expect(mockPrepareDeck.mock.calls[0][0].files).toBe(rangedFiles);
    });

    it('leaves every PDF whole when two PDFs are uploaded together', async () => {
      await runUploadGenerationInWorker(
        rangeTask([makePdf('one.pdf'), makePdf('two.pdf')])
      );

      expect(mockPrepareDeck).toHaveBeenCalledTimes(2);
      expect(mockApplyPdfPageRange).not.toHaveBeenCalled();
    });

    it('never slices a zip upload', async () => {
      await runUploadGenerationInWorker(rangeTask([makePdf('export.zip')]));

      expect(mockApplyPdfPageRange).not.toHaveBeenCalled();
      expect(mockGetPackagesFromZip).toHaveBeenCalledTimes(1);
    });
  });
});

describe('runUploadGenerationInWorker — files converted in parallel', () => {
  const mockSubdir = vi.mocked(Workspace.subdir);

  const makeHtml = (name: string) =>
    makeFile({
      originalname: name,
      filename: name,
      key: name,
      path: '',
      buffer: Buffer.from('<p>hi</p>'),
    });

  const deckFor = (name: string) => ({
    name,
    cardCount: 1,
    deck: [],
  });

  const task = (files: UploadedFile[]): UploadGenerationTask => ({
    paying: false,
    files,
    settings: new CardOption({}),
    workspace: { location: '/tmp/ws-parent' } as Workspace,
    enqueuedAt: Date.now(),
    userId: null,
  });

  let infoSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    let n = 0;
    mockSubdir.mockImplementation((parent: string) => {
      n += 1;
      return { id: `sub-${n}`, location: `${parent}/sub-${n}` } as Workspace;
    });
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('starts the second file before the first one finishes', async () => {
    let releaseFirst: () => void = () => {};
    const started: string[] = [];
    mockPrepareDeck.mockImplementation(async (input) => {
      started.push(input.name);
      if (input.name === 'a.html') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return deckFor(input.name) as never;
    });

    const run = runUploadGenerationInWorker(
      task([makeHtml('a.html'), makeHtml('b.html')])
    );
    await vi.waitFor(() => expect(started).toEqual(['a.html', 'b.html']));
    releaseFirst();
    const result = await run;

    expect(result.ok).toBe(true);
  });

  it('keeps packages in upload order when a later file finishes first', async () => {
    mockPrepareDeck.mockImplementation(async (input) => {
      if (input.name === 'a.html') {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return deckFor(input.name) as never;
    });

    const result = await runUploadGenerationInWorker(
      task([makeHtml('a.html'), makeHtml('b.html'), makeHtml('c.html')])
    );

    expect(result.ok).toBe(true);
    const names = result.ok ? result.packages.map((p) => p.name) : [];
    expect(names).toEqual(['a.html', 'b.html', 'c.html']);
  });

  it('gives each file its own workspace so decks never overwrite each other', async () => {
    mockPrepareDeck.mockImplementation(
      async (input) => deckFor(input.name) as never
    );

    await runUploadGenerationInWorker(
      task([makeHtml('a.html'), makeHtml('b.html')])
    );

    const locations = mockPrepareDeck.mock.calls.map(
      ([input]) => input.workspace.location
    );
    expect(locations).toEqual(['/tmp/ws-parent/sub-1', '/tmp/ws-parent/sub-2']);
  });

  it('reports the first failing file in upload order', async () => {
    mockPrepareDeck.mockImplementation(async (input) => {
      if (input.name === 'a.html') {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw new Error('first file broke');
      }
      throw new Error('second file broke');
    });

    const result = await runUploadGenerationInWorker(
      task([makeHtml('a.html'), makeHtml('b.html')])
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toBe('first file broke');
  });

  it('does not start queued files after one fails', async () => {
    const started: string[] = [];
    mockPrepareDeck.mockImplementation(async (input) => {
      started.push(input.name);
      if (input.name === 'a.html') throw new Error('a broke');
      await new Promise((resolve) => setTimeout(resolve, 20));
      return deckFor(input.name) as never;
    });

    const result = await runUploadGenerationInWorker(
      task([makeHtml('a.html'), makeHtml('b.html'), makeHtml('c.html')])
    );

    expect(result.ok).toBe(false);
    expect(started).toEqual(['a.html', 'b.html']);
  });

  it('reports a restart over an ordinary failure in the same upload', async () => {
    mockPrepareDeck.mockImplementation(async (input) => {
      if (input.name === 'a.html') throw new Error('a broke');
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw createWorkerTerminationError();
    });

    const result = await runUploadGenerationInWorker(
      task([makeHtml('a.html'), makeHtml('b.html')])
    );

    expect(result.ok ? '' : result.error.message).toBe(
      createWorkerTerminationError().message
    );
  });

  it('keeps an upload that includes a zip sequential', async () => {
    const events: string[] = [];
    mockPrepareDeck.mockImplementation(async (input) => {
      events.push(`start ${input.name}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push(`end ${input.name}`);
      return deckFor(input.name) as never;
    });
    mockGetPackagesFromZip.mockImplementation(async () => {
      events.push('start zip');
      return { packages: [], warnings: [] };
    });

    await runUploadGenerationInWorker(
      task([
        makeHtml('a.html'),
        makeFile({
          originalname: 'b.zip',
          key: 'b.zip',
          buffer: Buffer.from('PK'),
        }),
      ])
    );

    expect(events).toEqual(['start a.html', 'end a.html', 'start zip']);
    expect(mockSubdir).not.toHaveBeenCalled();
  });

  it('converts a single file in the shared workspace, as before', async () => {
    mockPrepareDeck.mockImplementation(
      async (input) => deckFor(input.name) as never
    );

    await runUploadGenerationInWorker(task([makeHtml('a.html')]));

    expect(mockSubdir).not.toHaveBeenCalled();
    expect(mockPrepareDeck.mock.calls[0][0].workspace.location).toBe(
      '/tmp/ws-parent'
    );
  });
});

describe('countAiContentFiles', () => {
  it('counts files that reach the Claude path: html/md/pdf and zips, not xml', () => {
    const files = [
      makeFile({ originalname: 'a.html' }),
      makeFile({ originalname: 'b.md' }),
      makeFile({ originalname: 'c.pdf' }),
      makeFile({ originalname: 'export.zip' }),
      makeFile({ originalname: 'deck.xml' }),
    ];
    expect(countAiContentFiles(files, true, makeClaudeSettings())).toBe(4);
  });

  it('does not count a Kindle clippings .txt (routed to the vocab path, not Claude)', () => {
    const files = [
      makeFile({ originalname: 'My Clippings.txt' }),
      makeFile({ originalname: 'notes.html' }),
    ];
    expect(countAiContentFiles(files, true, makeClaudeSettings())).toBe(1);
  });

  it('counts image-quiz images only when the image-quiz option is on', () => {
    const images = [
      makeFile({ originalname: 'slide1.png' }),
      makeFile({ originalname: 'slide2.png' }),
    ];
    const withQuiz = new CardOption({
      ...CardOption.LoadDefaultOptions(),
      'claude-ai-flashcards': 'true',
      'image-quiz-html-to-anki': 'true',
    });
    expect(countAiContentFiles(images, true, withQuiz)).toBe(2);
    expect(countAiContentFiles(images, true, makeClaudeSettings())).toBe(0);
  });
});

describe('shouldDedupeAcrossFiles', () => {
  const twoHtml = [
    makeFile({ originalname: 'a.html' }),
    makeFile({ originalname: 'b.html' }),
  ];

  it('is true for a paying AI upload with two or more content files', () => {
    expect(shouldDedupeAcrossFiles(true, makeClaudeSettings(), twoHtml)).toBe(
      true
    );
  });

  it('is false for a single content file', () => {
    expect(
      shouldDedupeAcrossFiles(true, makeClaudeSettings(), [twoHtml[0]])
    ).toBe(false);
  });

  it('is false when AI flashcards are off', () => {
    expect(shouldDedupeAcrossFiles(true, new CardOption({}), twoHtml)).toBe(
      false
    );
  });

  it('is false when the user is not paying', () => {
    expect(shouldDedupeAcrossFiles(false, makeClaudeSettings(), twoHtml)).toBe(
      false
    );
  });
});

describe('shouldDedupeAcrossDecks', () => {
  const oneHtml = [makeFile({ originalname: 'a.html' })];

  it('is true for a signed-in paying AI upload with a single content file', () => {
    expect(
      shouldDedupeAcrossDecks(true, makeClaudeSettings(), oneHtml, 7)
    ).toBe(true);
  });

  it('is false when the user is anonymous (no userId)', () => {
    expect(
      shouldDedupeAcrossDecks(true, makeClaudeSettings(), oneHtml, null)
    ).toBe(false);
  });

  it('is false when AI flashcards are off', () => {
    expect(shouldDedupeAcrossDecks(true, new CardOption({}), oneHtml, 7)).toBe(
      false
    );
  });

  it('is false when the user is not paying', () => {
    expect(
      shouldDedupeAcrossDecks(false, makeClaudeSettings(), oneHtml, 7)
    ).toBe(false);
  });

  it('is false when there is no AI content file', () => {
    const xmlOnly = [makeFile({ originalname: 'deck.xml' })];
    expect(
      shouldDedupeAcrossDecks(true, makeClaudeSettings(), xmlOnly, 7)
    ).toBe(false);
  });
});

describe('runUploadGenerationInWorker — cross-file dedup (loose multi-file)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeMultiFileTask(): UploadGenerationTask {
    return makeAiTask(['chapter.html', 'transcript.html']);
  }

  function makeAiTask(names: string[]): UploadGenerationTask {
    return {
      paying: true,
      files: names.map((name) =>
        makeFile({
          originalname: name,
          filename: name,
          key: name,
          path: '',
          buffer: Buffer.from(`<p>${name}</p>`),
        })
      ),
      settings: makeClaudeSettings(),
      workspace: {} as Workspace,
      enqueuedAt: Date.now(),
      userId: 7,
    };
  }

  it('stops queued AI files from starting after a file fails', async () => {
    mockPrepareDeck.mockRejectedValueOnce(new Error('chapter broke'));
    const names = ['a.html', 'b.html', 'c.html', 'd.html', 'e.html'];

    const result = await runUploadGenerationInWorker(makeAiTask(names));

    expect(result.ok).toBe(false);
    expect(mockPrepareDeck).toHaveBeenCalledTimes(AI_FILE_CONCURRENCY);
  });

  it('converts AI files side by side on one shared dedup state', async () => {
    let releaseFirst: () => void = () => {};
    const started: string[] = [];
    const states: unknown[] = [];
    mockPrepareDeck.mockImplementation(async (input) => {
      started.push(input.name);
      states.push(input.crossFileDedup);
      if (input.name === 'a.html') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
      }
      return { name: input.name, deck: [], cardCount: 1 } as never;
    });

    const run = runUploadGenerationInWorker(
      makeAiTask(['a.html', 'b.html', 'c.html'])
    );
    await vi.waitFor(() =>
      expect(started).toEqual(['a.html', 'b.html', 'c.html'])
    );
    releaseFirst();
    const result = await run;

    expect(result.ok).toBe(true);
    expect(states[0]).toBeDefined();
    expect(new Set(states).size).toBe(1);
  });

  it('threads one dedup state across loose files and emits the suppressed count', async () => {
    const trackMod = trackModule;
    const trackSpy = vi
      .spyOn(trackMod, 'track')
      .mockImplementation(() => undefined);

    const statesSeen: unknown[] = [];
    mockPrepareDeck.mockImplementation(async (input) => {
      statesSeen.push(input.crossFileDedup);
      if (input.crossFileDedup) {
        absorbFileIntoCrossFileDedup(input.crossFileDedup, [
          oneCardDeck(input.name, 'Shared fact', 'Same answer'),
        ]);
      }
      return {
        name: input.name,
        apkg: Buffer.from('x'),
        deck: [],
        cardCount: 1,
      } as never;
    });

    const result = await runUploadGenerationInWorker(makeMultiFileTask());
    expect(result.ok).toBe(true);

    expect(mockPrepareDeck).toHaveBeenCalledTimes(2);
    expect(statesSeen[0]).toBeDefined();
    expect(statesSeen[0]).toBe(statesSeen[1]);

    const completed = trackSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'ai_conversion_completed'
    );
    expect(completed).toBeDefined();
    expect(
      completed![1] as { userId?: number; props?: Record<string, unknown> }
    ).toMatchObject({
      userId: 7,
      props: {
        source_file_count: 2,
        cross_file_duplicates_suppressed: 1,
      },
    });
  });

  it('does not thread a dedup state for an anonymous single-file upload', async () => {
    const trackMod = trackModule;
    const trackSpy = vi
      .spyOn(trackMod, 'track')
      .mockImplementation(() => undefined);

    mockPrepareDeck.mockResolvedValue({
      name: 'solo.html',
      apkg: Buffer.from('x'),
      deck: [],
      cardCount: 1,
    } as never);

    const task = makeMultiFileTask();
    task.files = [task.files[0]];
    task.userId = null;

    const result = await runUploadGenerationInWorker(task);

    expect(mockPrepareDeck.mock.calls[0][0].crossFileDedup).toBeUndefined();
    if (!result.ok) throw new Error('expected success');
    expect(result.cardFingerprints).toBeUndefined();
    const completed = trackSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'ai_conversion_completed'
    );
    expect(completed).toBeUndefined();
  });

  it('threads a state and returns fingerprints for a signed-in single-file AI upload', async () => {
    const trackMod = trackModule;
    const trackSpy = vi
      .spyOn(trackMod, 'track')
      .mockImplementation(() => undefined);

    mockPrepareDeck.mockImplementation(async (input) => {
      if (input.crossFileDedup) {
        absorbFileIntoCrossFileDedup(input.crossFileDedup, [
          oneCardDeck(input.name, 'Solo fact', 'Solo answer'),
        ]);
      }
      return {
        name: input.name,
        apkg: Buffer.from('x'),
        deck: [],
        cardCount: 1,
      } as never;
    });

    const task = makeMultiFileTask();
    task.files = [task.files[0]];

    const result = await runUploadGenerationInWorker(task);
    if (!result.ok) throw new Error('expected success');

    expect(mockPrepareDeck.mock.calls[0][0].crossFileDedup).toBeDefined();
    expect(result.cardFingerprints).toEqual([
      cardFingerprint({ name: 'Solo fact', back: 'Solo answer' }),
    ]);
    const completed = trackSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'ai_conversion_completed'
    );
    expect(completed).toBeUndefined();
  });

  it('suppresses a card matching seeded history and reports the cross-deck count', async () => {
    const trackMod = trackModule;
    const trackSpy = vi
      .spyOn(trackMod, 'track')
      .mockImplementation(() => undefined);

    mockPrepareDeck.mockImplementation(async (input) => {
      if (input.crossFileDedup) {
        absorbFileIntoCrossFileDedup(input.crossFileDedup, [
          oneCardDeck(input.name, 'Old fact', 'Old answer'),
        ]);
      }
      return {
        name: input.name,
        apkg: Buffer.from('x'),
        deck: [],
        cardCount: 0,
      } as never;
    });

    const task = makeMultiFileTask();
    task.files = [task.files[0]];
    task.existingCardFingerprints = [
      cardFingerprint({ name: 'Old fact', back: 'Old answer' }),
    ];

    const result = await runUploadGenerationInWorker(task);
    if (!result.ok) throw new Error('expected success');

    expect(result.cardFingerprints).toEqual([]);
    const completed = trackSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'ai_conversion_completed'
    );
    expect(completed![1] as { props?: Record<string, unknown> }).toMatchObject({
      props: {
        cross_deck_duplicates_suppressed: 1,
        historical_cards_considered: 1,
      },
    });
  });

  it('succeeds and keeps earlier decks when a later loose file is fully suppressed', async () => {
    const trackMod = trackModule;
    vi.spyOn(trackMod, 'track').mockImplementation(() => undefined);

    mockPrepareDeck.mockImplementation(async (input) => {
      const isFirst = input.name === 'chapter.html';
      if (input.crossFileDedup) {
        absorbFileIntoCrossFileDedup(input.crossFileDedup, [
          oneCardDeck(input.name, 'Shared fact', 'Same answer'),
        ]);
      }
      if (isFirst) {
        return {
          name: input.name,
          apkg: Buffer.from('x'),
          deck: [],
          cardCount: 1,
        } as never;
      }
      return undefined as never;
    });

    const result = await runUploadGenerationInWorker(makeMultiFileTask());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe('chapter.html');
  });

  it('shares one accumulator across loose files and a zip, emitting a single event', async () => {
    const trackMod = trackModule;
    const trackSpy = vi
      .spyOn(trackMod, 'track')
      .mockImplementation(() => undefined);

    const looseStates: unknown[] = [];
    mockPrepareDeck.mockImplementation(async (input) => {
      looseStates.push(input.crossFileDedup);
      if (input.crossFileDedup) {
        absorbFileIntoCrossFileDedup(input.crossFileDedup, [
          oneCardDeck(input.name, `Fact ${input.name}`, 'Answer'),
        ]);
      }
      return {
        name: input.name,
        apkg: Buffer.from('x'),
        deck: [],
        cardCount: 1,
      } as never;
    });

    let zipState: CrossFileDedupState | undefined;
    mockGetPackagesFromZip.mockImplementation(async (...args) => {
      const crossFileDedup = args[6]?.crossFileDedup;
      zipState = crossFileDedup;
      if (crossFileDedup) {
        absorbFileIntoCrossFileDedup(crossFileDedup, [
          oneCardDeck('page.html', 'Zip fact', 'Answer'),
        ]);
      }
      return { packages: [], warnings: [] };
    });

    const task = makeMultiFileTask();
    task.files = [
      task.files[0],
      task.files[1],
      makeFile({
        originalname: 'notes.zip',
        filename: 'notes.zip',
        key: 'notes.zip',
        path: '',
        buffer: Buffer.from('PK zip bytes'),
      }),
    ];

    await runUploadGenerationInWorker(task);

    expect(mockGetPackagesFromZip).toHaveBeenCalledTimes(1);
    expect(looseStates[0]).toBeDefined();
    expect(zipState).toBe(looseStates[0]);

    const completedEvents = trackSpy.mock.calls.filter(
      (call: unknown[]) => call[0] === 'ai_conversion_completed'
    );
    expect(completedEvents).toHaveLength(1);
    expect(
      completedEvents[0][1] as { props?: Record<string, unknown> }
    ).toMatchObject({
      props: { source_file_count: 3 },
    });
  });

  it('threads the card limit into the zip path and surfaces cardsHeldBack', async () => {
    mockGetPackagesFromZip.mockResolvedValue({
      packages: [],
      warnings: [],
      cardsHeldBack: 9,
    });

    const zipFile = makeFile({
      originalname: 'notes.zip',
      filename: 'notes.zip',
      key: 'notes.zip',
      path: '',
      buffer: Buffer.from('PK zip bytes'),
    });

    const result = await runUploadGenerationInWorker({
      paying: false,
      files: [zipFile],
      settings: new CardOption({}),
      workspace: {} as Workspace,
      enqueuedAt: Date.now(),
      userId: null,
      cardLimit: 21,
    });

    expect(mockGetPackagesFromZip).toHaveBeenCalledTimes(1);
    const options = mockGetPackagesFromZip.mock.calls[0][6];
    expect(options?.cardLimit).toBe(21);
    expect(result).toMatchObject({ ok: true, cardsHeldBack: 9 });
  });
});
