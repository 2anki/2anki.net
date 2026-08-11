import { setupTests } from '../../test/configure-jest';
import { getPackagesFromZip } from './getPackagesFromZip';
import CardOption from '../../lib/parser/Settings/CardOption';
import Workspace from '../../lib/parser/WorkSpace';

jest.mock('../../infrastracture/adapters/fileConversion/PrepareDeck');
jest.mock('../../lib/zip/zip');
jest.mock('../../lib/anki/CardGenerator');
jest.mock('../../lib/parser/WorkSpace');

const mockPrepareDeck = jest.requireMock<{
  PrepareDeck: jest.Mock;
  prepareDeckInfoOnly: jest.Mock;
}>('../../infrastracture/adapters/fileConversion/PrepareDeck').PrepareDeck;

const mockPrepareDeckInfoOnly = jest.requireMock<{
  PrepareDeck: jest.Mock;
  prepareDeckInfoOnly: jest.Mock;
}>(
  '../../infrastracture/adapters/fileConversion/PrepareDeck'
).prepareDeckInfoOnly;

const mockCardGeneratorClass = jest.requireMock<{ default: jest.Mock }>(
  '../../lib/anki/CardGenerator'
).default;

const mockZipHandlerClass = jest.requireMock<{ ZipHandler: jest.Mock }>(
  '../../lib/zip/zip'
).ZipHandler;

const FAKE_WORKSPACE_LOCATION = '/fake/workspace';

beforeEach(() => {
  setupTests();
  jest.clearAllMocks();

  (Workspace as unknown as Record<string, jest.Mock>).subdir = jest
    .fn()
    .mockReturnValue({ location: `${FAKE_WORKSPACE_LOCATION}/sub` });

  mockCardGeneratorClass.mockImplementation(() => ({
    runBatch: jest.fn().mockResolvedValue([]),
  }));
});

describe('getPackagesFromZip — batch concurrency', () => {
  it('returns all packages when batch mode resolves correctly', async () => {
    const fileCount = 8;
    const fileNames = Array.from(
      { length: fileCount },
      (_, i) => `deck${i}.html`
    );

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: '<html></html>' })),
    }));

    mockPrepareDeckInfoOnly.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        deckInfoPath: `/fake/${name}/deck_info.json`,
        outputPath: `/fake/${name}/out.apkg`,
        name,
        inputFileName: name,
        deck: [],
        cardCount: 1,
        needsIndividualBuild: false,
      })
    );

    mockCardGeneratorClass.mockImplementation(() => ({
      runBatch: jest
        .fn()
        .mockImplementation((entries: Array<{ output: string }>) =>
          Promise.resolve(entries.map((e) => e.output))
        ),
    }));

    jest
      .spyOn(require('node:fs'), 'readFileSync')
      .mockReturnValue(Buffer.from('fake-apkg'));

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    const result = await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    expect(result.packages).toHaveLength(fileCount);
  });

  const previousMaxPython = process.env.MAX_PYTHON_WORKERS;
  const previousConversionWorkers = process.env.CONVERSION_WORKERS;

  afterEach(() => {
    if (previousMaxPython === undefined) {
      delete process.env.MAX_PYTHON_WORKERS;
    } else {
      process.env.MAX_PYTHON_WORKERS = previousMaxPython;
    }
    if (previousConversionWorkers === undefined) {
      delete process.env.CONVERSION_WORKERS;
    } else {
      process.env.CONVERSION_WORKERS = previousConversionWorkers;
    }
  });

  it('passes parent workspace as outputWorkspace so .apkg files land where the downloader looks', async () => {
    const fileNames = ['deck0.html', 'deck1.html', 'deck2.html'];

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: '<html></html>' })),
    }));

    mockPrepareDeckInfoOnly.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        deckInfoPath: `/fake/${name}/deck_info.json`,
        outputPath: `${FAKE_WORKSPACE_LOCATION}/${name}.apkg`,
        name,
        inputFileName: name,
        deck: [],
        cardCount: 1,
        needsIndividualBuild: false,
      })
    );

    mockCardGeneratorClass.mockImplementation(() => ({
      runBatch: jest
        .fn()
        .mockImplementation((entries: Array<{ output: string }>) =>
          Promise.resolve(entries.map((e) => e.output))
        ),
    }));

    process.env.MAX_PYTHON_WORKERS = '1';

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    expect(mockPrepareDeckInfoOnly).toHaveBeenCalled();
    for (const call of mockPrepareDeckInfoOnly.mock.calls) {
      const [, deckSubWorkspace, outputWorkspace] = call;
      expect(outputWorkspace).toBe(workspace);
      expect(outputWorkspace.location).toBe(FAKE_WORKSPACE_LOCATION);
      expect(deckSubWorkspace.location).not.toBe(FAKE_WORKSPACE_LOCATION);
    }
  });

  it('falls through to single-file path when only one file is in the zip', async () => {
    const fileNames = ['only.html'];

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: '<html></html>' })),
    }));

    mockPrepareDeck.mockResolvedValue({
      name: 'only.html',
      apkg: Buffer.from(''),
      deck: [],
      cardCount: 1,
    });

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    expect(mockPrepareDeck).toHaveBeenCalledTimes(1);
    expect(mockPrepareDeckInfoOnly).not.toHaveBeenCalled();
  });

  // Two files take the all-in-one path (cap 2 → one chunk). Sharing one
  // workspace means the second conversion overwrites the first's deck_info.json
  // before the Python child reads it, so both build the same deck and one is
  // lost — while the user is still billed for both.
  it('gives every all-in-one conversion its own workspace', async () => {
    const fileNames = ['first.html', 'second.html'];
    let subdirCount = 0;
    (Workspace as unknown as Record<string, jest.Mock>).subdir = jest
      .fn()
      .mockImplementation(() => ({
        location: `${FAKE_WORKSPACE_LOCATION}/sub-${subdirCount++}`,
      }));

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: '<html></html>' })),
    }));

    mockPrepareDeck.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        name,
        apkg: Buffer.from(''),
        deck: [],
        cardCount: 1,
      })
    );

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    expect(mockPrepareDeck).toHaveBeenCalledTimes(2);
    const usedLocations = mockPrepareDeck.mock.calls.map(
      (call) => call[0].workspace.location
    );
    expect(new Set(usedLocations).size).toBe(2);
    expect(usedLocations).not.toContain(FAKE_WORKSPACE_LOCATION);
  });

  it('caps batch chunks at the derived per-worker Python budget (default 2)', async () => {
    const fileCount = 12;
    const fileNames = Array.from(
      { length: fileCount },
      (_, i) => `deck${i}.html`
    );

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: '<html></html>' })),
    }));

    mockPrepareDeckInfoOnly.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        deckInfoPath: `/fake/${name}/deck_info.json`,
        outputPath: `/fake/${name}/out.apkg`,
        name,
        inputFileName: name,
        deck: [],
        cardCount: 1,
        needsIndividualBuild: false,
      })
    );

    let runBatchCallCount = 0;
    mockCardGeneratorClass.mockImplementation(() => ({
      runBatch: jest
        .fn()
        .mockImplementation((entries: Array<{ output: string }>) => {
          runBatchCallCount += 1;
          return Promise.resolve(entries.map((e) => e.output));
        }),
    }));

    jest
      .spyOn(require('node:fs'), 'readFileSync')
      .mockReturnValue(Buffer.from('fake-apkg'));

    delete process.env.MAX_PYTHON_WORKERS;
    delete process.env.CONVERSION_WORKERS;

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    expect(runBatchCallCount).toBeLessThanOrEqual(2);
  });

  it('respects the derived per-worker cap from MAX_PYTHON_WORKERS and pool size', async () => {
    process.env.MAX_PYTHON_WORKERS = '4';
    process.env.CONVERSION_WORKERS = '2';

    const fileCount = 6;
    const fileNames = Array.from(
      { length: fileCount },
      (_, i) => `deck${i}.html`
    );

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: '<html></html>' })),
    }));

    mockPrepareDeckInfoOnly.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        deckInfoPath: `/fake/${name}/deck_info.json`,
        outputPath: `/fake/${name}/out.apkg`,
        name,
        inputFileName: name,
        deck: [],
        cardCount: 1,
        needsIndividualBuild: false,
      })
    );

    let runBatchCallCount = 0;
    mockCardGeneratorClass.mockImplementation(() => ({
      runBatch: jest
        .fn()
        .mockImplementation((entries: Array<{ output: string }>) => {
          runBatchCallCount += 1;
          return Promise.resolve(entries.map((e) => e.output));
        }),
    }));

    jest
      .spyOn(require('node:fs'), 'readFileSync')
      .mockReturnValue(Buffer.from('fake-apkg'));

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    expect(runBatchCallCount).toBeLessThanOrEqual(2);
  });

  it('rebuilds every deck individually when the whole batch build fails', async () => {
    const fileCount = 8;
    const fileNames = Array.from(
      { length: fileCount },
      (_, i) => `deck${i}.html`
    );

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: '<html></html>' })),
    }));

    mockPrepareDeckInfoOnly.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        deckInfoPath: `/fake/${name}/deck_info.json`,
        outputPath: `/fake/${name}/out.apkg`,
        name,
        inputFileName: name,
        deck: [],
        cardCount: 1,
        needsIndividualBuild: false,
      })
    );

    mockPrepareDeck.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        name,
        apkg: Buffer.from('fake-apkg'),
        deck: [],
        cardCount: 1,
        mcqCount: 0,
        mcqSkippedCount: 0,
        droppedImageCount: 0,
        expiredNotionImageCount: 0,
        emptyBackCount: 0,
      })
    );

    mockCardGeneratorClass.mockImplementation(() => ({
      runBatch: jest.fn().mockRejectedValue(new Error('Python batch failed')),
    }));

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    const result = await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    expect(result.packages).toHaveLength(fileCount);
    expect(
      result.warnings?.some((w) => w.includes('could not be converted')) ??
        false
    ).toBe(false);
  });

  it('retries a deck individually when the batch produced no apkg for it', async () => {
    const fileCount = 8;
    const fileNames = Array.from(
      { length: fileCount },
      (_, i) => `deck${i}.html`
    );

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: '<html></html>' })),
    }));

    mockPrepareDeckInfoOnly.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        deckInfoPath: `/fake/${name}/deck_info.json`,
        outputPath: `/fake/${name}/out.apkg`,
        name,
        inputFileName: name,
        deck: [],
        cardCount: 1,
        needsIndividualBuild: false,
      })
    );

    mockPrepareDeck.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        name,
        apkg: Buffer.from('fake-apkg'),
        deck: [],
        cardCount: 1,
        mcqCount: 0,
        mcqSkippedCount: 0,
        droppedImageCount: 0,
        expiredNotionImageCount: 0,
        emptyBackCount: 0,
      })
    );

    mockCardGeneratorClass.mockImplementation(() => ({
      runBatch: jest
        .fn()
        .mockImplementation((entries: Array<{ output: string }>) =>
          Promise.resolve(
            entries
              .filter((e) => !e.output.includes('deck3.html'))
              .map((e) => e.output)
          )
        ),
    }));

    jest
      .spyOn(require('node:fs'), 'readFileSync')
      .mockReturnValue(Buffer.from('fake-apkg'));

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    const result = await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    expect(result.packages).toHaveLength(fileCount);
    const retriedNames = mockPrepareDeck.mock.calls.map((call) => call[0].name);
    expect(retriedNames).toEqual(['deck3.html']);
  });

  it('does not retry a deck the batch skipped because it had zero cards', async () => {
    const fileCount = 8;
    const fileNames = Array.from(
      { length: fileCount },
      (_, i) => `deck${i}.html`
    );

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: '<html></html>' })),
    }));

    mockPrepareDeckInfoOnly.mockImplementation(({ name }: { name: string }) =>
      Promise.resolve({
        deckInfoPath: `/fake/${name}/deck_info.json`,
        outputPath: `/fake/${name}/out.apkg`,
        name,
        inputFileName: name,
        deck: [],
        cardCount: name === 'deck5.html' ? 0 : 1,
        needsIndividualBuild: false,
      })
    );

    mockCardGeneratorClass.mockImplementation(() => ({
      runBatch: jest
        .fn()
        .mockImplementation((entries: Array<{ output: string }>) =>
          Promise.resolve(
            entries
              .filter((e) => !e.output.includes('deck5.html'))
              .map((e) => e.output)
          )
        ),
    }));

    jest
      .spyOn(require('node:fs'), 'readFileSync')
      .mockReturnValue(Buffer.from('fake-apkg'));

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    const result = await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    expect(result.packages).toHaveLength(fileCount - 1);
    expect(mockPrepareDeck).not.toHaveBeenCalled();
  });

  it('skips one file that fails to convert in the batch path and returns the rest', async () => {
    const fileCount = 8;
    const fileNames = Array.from(
      { length: fileCount },
      (_, i) => `deck${i}.html`
    );

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: '<html></html>' })),
    }));

    mockPrepareDeckInfoOnly.mockImplementation(({ name }: { name: string }) => {
      if (name === 'deck3.html') {
        return Promise.reject(new Error('docx_parse_failed: unreadable'));
      }
      return Promise.resolve({
        deckInfoPath: `/fake/${name}/deck_info.json`,
        outputPath: `/fake/${name}/out.apkg`,
        name,
        inputFileName: name,
        deck: [],
        cardCount: 1,
        needsIndividualBuild: false,
      });
    });

    mockCardGeneratorClass.mockImplementation(() => ({
      runBatch: jest
        .fn()
        .mockImplementation((entries: Array<{ output: string }>) =>
          Promise.resolve(entries.map((e) => e.output))
        ),
    }));

    jest
      .spyOn(require('node:fs'), 'readFileSync')
      .mockReturnValue(Buffer.from('fake-apkg'));

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    const result = await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    const names = result.packages.map((p) => p.name);
    expect(names).toHaveLength(fileCount - 1);
    expect(names).not.toContain('deck3.html');
    expect(result.warnings).toContain(
      'deck3.html could not be converted and was skipped. The rest of your upload converted — try uploading that file on its own.'
    );
  });

  it('returns empty packages when fileContents is undefined', async () => {
    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    const result = await getPackagesFromZip(
      undefined,
      false,
      settings,
      workspace
    );

    expect(result.packages).toEqual([]);
  });
});

describe('getPackagesFromZip — encrypted PDFs', () => {
  const PASSWORD_SENTINEL_PREFIX = 'PDF_NEEDS_PASSWORD\x00';

  const previousMaxPython = process.env.MAX_PYTHON_WORKERS;
  const previousConversionWorkers = process.env.CONVERSION_WORKERS;

  afterEach(() => {
    if (previousMaxPython === undefined) {
      delete process.env.MAX_PYTHON_WORKERS;
    } else {
      process.env.MAX_PYTHON_WORKERS = previousMaxPython;
    }
    if (previousConversionWorkers === undefined) {
      delete process.env.CONVERSION_WORKERS;
    } else {
      process.env.CONVERSION_WORKERS = previousConversionWorkers;
    }
  });

  it('skips every locked PDF and still converts the rest, warning once per locked file', async () => {
    process.env.MAX_PYTHON_WORKERS = '8';
    process.env.CONVERSION_WORKERS = '1';

    const fileNames = ['Ch1.pdf', 'notes.html', 'Ch2.pdf'];

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: Buffer.from(name) })),
    }));

    mockPrepareDeck.mockImplementation(({ name }: { name: string }) => {
      if (name.endsWith('.pdf')) {
        return Promise.reject(new Error(`${PASSWORD_SENTINEL_PREFIX}${name}`));
      }
      return Promise.resolve({
        name,
        apkg: Buffer.from(''),
        deck: [],
        cardCount: 4,
        mcqCount: 0,
        mcqSkippedCount: 0,
      });
    });

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    const result = await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    expect(result.packages).toHaveLength(1);
    expect(result.packages[0].name).toBe('notes.html');
    expect(result.warnings).toEqual([
      '2 password-protected PDFs were skipped: Ch1.pdf, Ch2.pdf. Unlock each in Preview or Adobe Reader, save a copy, and upload them on their own.',
    ]);
  });

  it('skips locked PDFs in the batch path without aborting the whole job', async () => {
    process.env.MAX_PYTHON_WORKERS = '2';
    process.env.CONVERSION_WORKERS = '1';

    const fileNames = ['Ch1.pdf', 'Ch2.pdf', 'Ch3.pdf', 'good.html'];

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: Buffer.from(name) })),
    }));

    mockPrepareDeckInfoOnly.mockImplementation(({ name }: { name: string }) => {
      if (name.endsWith('.pdf')) {
        return Promise.reject(new Error(`${PASSWORD_SENTINEL_PREFIX}${name}`));
      }
      return Promise.resolve({
        deckInfoPath: `/fake/${name}/deck_info.json`,
        outputPath: `/fake/${name}/out.apkg`,
        name,
        inputFileName: name,
        deck: [],
        cardCount: 2,
        mcqCount: 0,
        mcqSkippedCount: 0,
        needsIndividualBuild: false,
      });
    });

    mockCardGeneratorClass.mockImplementation(() => ({
      runBatch: jest
        .fn()
        .mockImplementation((entries: Array<{ output: string }>) =>
          Promise.resolve(entries.map((e) => e.output))
        ),
    }));

    jest
      .spyOn(require('node:fs'), 'readFileSync')
      .mockReturnValue(Buffer.from('fake-apkg'));

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    const result = await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    expect(result.packages.map((p) => p.name)).toEqual(['good.html']);
    expect(result.warnings).toContain(
      '3 password-protected PDFs were skipped: Ch1.pdf, Ch2.pdf, Ch3.pdf. Unlock each in Preview or Adobe Reader, save a copy, and upload them on their own.'
    );
  });

  it('skips a file whose converter throws a non-password error and returns the rest', async () => {
    process.env.MAX_PYTHON_WORKERS = '8';
    process.env.CONVERSION_WORKERS = '1';

    const fileNames = ['notes.html', 'broken.pdf'];

    mockZipHandlerClass.mockImplementation(() => ({
      build: jest.fn().mockResolvedValue(undefined),
      getFileNames: jest.fn().mockReturnValue(fileNames),
      files: fileNames.map((name) => ({ name, contents: Buffer.from(name) })),
    }));

    mockPrepareDeck.mockImplementation(({ name }: { name: string }) => {
      if (name === 'broken.pdf') {
        return Promise.reject(new Error('pdfinfo_failed: corrupt stream'));
      }
      return Promise.resolve({
        name,
        apkg: Buffer.from(''),
        deck: [],
        cardCount: 1,
      });
    });

    const settings = new CardOption({});
    const workspace = { location: FAKE_WORKSPACE_LOCATION } as Workspace;

    const result = await getPackagesFromZip(
      Buffer.from('fake-zip') as unknown as Uint8Array,
      false,
      settings,
      workspace
    );

    expect(result.packages.map((p) => p.name)).toEqual(['notes.html']);
    expect(result.warnings).toContain(
      'broken.pdf could not be converted and was skipped. The rest of your upload converted — try uploading that file on its own.'
    );
  });
});
