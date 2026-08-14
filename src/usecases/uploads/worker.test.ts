import fs from 'fs';
import type { MessagePort } from 'node:worker_threads';
import {
  getFileContents,
  runUploadGenerationInWorker,
  countAiContentFiles,
  shouldDedupeAcrossFiles,
} from './worker';
import { UploadedFile } from '../../lib/storage/types';
import CardOption from '../../lib/parser/Settings/CardOption';
import Workspace from '../../lib/parser/WorkSpace';
import { UploadGenerationTask } from './uploadGenerationTypes';
import { absorbFileIntoCrossFileDedup } from '../../lib/claude/ClaudeService';
import { PrepareDeck } from '../../infrastracture/adapters/fileConversion/PrepareDeck';

jest.mock('fs');
jest.mock('../../lib/parser/WorkSpace');
jest.mock('../../infrastracture/adapters/fileConversion/PrepareDeck', () => ({
  PrepareDeck: jest.fn(),
}));

const mockFs = jest.mocked(fs);
const mockPrepareDeck = jest.mocked(PrepareDeck);

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
    jest.clearAllMocks();
  });

  describe('dwell time logging', () => {
    let infoSpy: jest.SpyInstance;

    beforeEach(() => {
      infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    });

    afterEach(() => {
      infoSpy.mockRestore();
    });

    it('logs dwellMs >= 0 when reading from buffer', () => {
      jest.useFakeTimers();
      jest.setSystemTime(1000);

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

      jest.useRealTimers();
    });

    it('logs dwellMs >= 0 when reading from disk', () => {
      jest.useFakeTimers();
      jest.setSystemTime(2000);

      const content = Buffer.from('disk content');
      const file = makeFile({ path: '/tmp/upload-exists' });
      mockFs.existsSync = jest.fn().mockReturnValue(true);
      mockFs.readFileSync = jest.fn().mockReturnValue(content);

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

      jest.useRealTimers();
    });
  });

  it('throws when path is set to a missing file and buffer is undefined', () => {
    const file = makeFile({
      path: '/tmp/upload-gone',
      buffer: undefined as never,
    });
    mockFs.existsSync = jest.fn().mockReturnValue(false);

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
    mockFs.existsSync = jest.fn().mockReturnValue(false);

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
    mockFs.existsSync = jest.fn().mockReturnValue(true);
    mockFs.readFileSync = jest.fn().mockReturnValue(content);

    const result = getFileContents(file);

    expect(result).toEqual(content);
  });
});

describe('runUploadGenerationInWorker', () => {
  function makeFakePort(): MessagePort {
    return {
      postMessage: jest.fn(),
      close: jest.fn(),
    } as unknown as MessagePort;
  }

  function makeTask(
    file: UploadedFile,
    progressPort?: MessagePort
  ): UploadGenerationTask {
    return {
      paying: false,
      files: [file],
      settings: new CardOption({}),
      workspace: {} as Workspace,
      enqueuedAt: Date.now(),
      userId: null,
      progressPort,
    };
  }

  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
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

  it('closes the progress port even when generation throws', async () => {
    const port = makeFakePort();
    const file = makeFile({
      originalname: 'existing.apkg',
      filename: 'existing.apkg',
      path: '',
      buffer: Buffer.from('not really a deck'),
    });

    await runUploadGenerationInWorker(makeTask(file, port));

    expect(port.close).toHaveBeenCalledTimes(1);
  });

  it('returns a success result with empty packages for an unsupported file type', async () => {
    const file = makeFile({
      originalname: 'notes.unsupported',
      filename: 'notes.unsupported',
      key: 'notes.unsupported',
      path: '',
      buffer: Buffer.from('plain text'),
    });
    const port = makeFakePort();

    const result = await runUploadGenerationInWorker(makeTask(file, port));

    expect(result).toEqual({ ok: true, packages: [], warnings: [] });
    expect(port.close).toHaveBeenCalledTimes(1);
  });
});

describe('countAiContentFiles', () => {
  it('counts html, markdown, and pdf content files, ignoring zips and xml', () => {
    const files = [
      makeFile({ originalname: 'a.html' }),
      makeFile({ originalname: 'b.md' }),
      makeFile({ originalname: 'c.pdf' }),
      makeFile({ originalname: 'export.zip' }),
      makeFile({ originalname: 'deck.xml' }),
    ];
    expect(countAiContentFiles(files)).toBe(3);
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

describe('runUploadGenerationInWorker — cross-file dedup (loose multi-file)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeMultiFileTask(): UploadGenerationTask {
    return {
      paying: true,
      files: [
        makeFile({
          originalname: 'chapter.html',
          filename: 'chapter.html',
          key: 'chapter.html',
          path: '',
          buffer: Buffer.from('<p>chapter</p>'),
        }),
        makeFile({
          originalname: 'transcript.html',
          filename: 'transcript.html',
          key: 'transcript.html',
          path: '',
          buffer: Buffer.from('<p>transcript</p>'),
        }),
      ],
      settings: makeClaudeSettings(),
      workspace: {} as Workspace,
      enqueuedAt: Date.now(),
      userId: 7,
    };
  }

  it('threads one dedup state across loose files and emits the suppressed count', async () => {
    const trackMod = require('../../services/events/track');
    const trackSpy = jest
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

  it('does not thread a dedup state for a single-file upload', async () => {
    const trackMod = require('../../services/events/track');
    const trackSpy = jest
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

    await runUploadGenerationInWorker(task);

    expect(mockPrepareDeck.mock.calls[0][0].crossFileDedup).toBeUndefined();
    const completed = trackSpy.mock.calls.find(
      (call: unknown[]) => call[0] === 'ai_conversion_completed'
    );
    expect(completed).toBeUndefined();
  });
});
