import { vi, type MockedFunction } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { strToU8, zipSync } from 'fflate';

import {
  ZipHandler,
  INCOMPLETE_ZIP_MESSAGE,
  DAMAGED_ZIP_MESSAGE,
  MAX_IN_MEMORY_BYTES,
  MAX_EXTRACTED_BYTES,
  MAX_BATCH_EXTRACT_BYTES,
} from './zip';
import { MAX_OLD_GENERATION_SIZE_MB } from '../conversionMemoryLimits';
import CardOption from '../parser/Settings';
import { processAndPrepareArchiveData } from './fallback/processAndPrepareArchiveData';
import { convertImageToHTML } from '../../infrastracture/adapters/fileConversion/convertImageToHTML';

vi.mock('./fallback/processAndPrepareArchiveData');
vi.mock(
  '../../infrastracture/adapters/fileConversion/convertImageToHTML',
  () => ({
    convertImageToHTML: vi.fn(async () => '<p>read from the photo</p>'),
  })
);

const mockedFallback = processAndPrepareArchiveData as MockedFunction<
  typeof processAndPrepareArchiveData
>;

function makeSpillDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ziphandler-spill-'));
}

function buildZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, contents] of Object.entries(files)) {
    entries[name] = strToU8(contents);
  }
  return zipSync(entries);
}

function buildBinaryZip(files: Record<string, number>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, size] of Object.entries(files)) {
    // Incompressible-ish payload so fflate keeps it near `size` decompressed;
    // the guard measures decompressed length, which is what we assert on.
    entries[name] = new Uint8Array(size).fill(1);
  }
  return zipSync(entries, { level: 0 });
}

describe('ZipHandler entry-name safety', () => {
  it('drops absolute-path entries while keeping safe entries', async () => {
    const zip = buildZip({
      'safe.html': '<p>safe</p>',
      '/etc/passwd.html': '<p>evil</p>',
    });

    const handler = new ZipHandler(10);
    await handler.build(zip, false, new CardOption({}));

    const names = handler.getFileNames();
    expect(names).toContain('safe.html');
    expect(names).not.toContain('/etc/passwd.html');
  });

  it('drops mid-path traversal entries that escape the destination', async () => {
    const zip = buildZip({
      'notes.md': '# notes',
      'a/../../escape.html': '<p>evil</p>',
    });

    const handler = new ZipHandler(10);
    await handler.build(zip, false, new CardOption({}));

    const names = handler.getFileNames();
    expect(names).toContain('notes.md');
    expect(names).not.toContain('a/../../escape.html');
    expect(names.some((n) => n.includes('..'))).toBe(false);
  });

  it('drops leading-dot-dot traversal entries', async () => {
    const zip = buildZip({
      'ok.html': '<p>ok</p>',
      '../../../../tmp/evil.html': '<p>evil</p>',
    });

    const handler = new ZipHandler(10);
    await handler.build(zip, false, new CardOption({}));

    const names = handler.getFileNames();
    expect(names).toContain('ok.html');
    expect(names.some((n) => n.includes('..'))).toBe(false);
  });

  it('keeps legitimate nested names with spaces and ampersands', async () => {
    const zip = buildZip({
      'Private & Shared/SLE/page.html': '<p>real deck</p>',
      'Private & Shared/SLE/notes.md': '# real',
    });

    const handler = new ZipHandler(10);
    await handler.build(zip, false, new CardOption({}));

    const names = handler.getFileNames();
    expect(names).toContain('Private & Shared/SLE/page.html');
    expect(names).toContain('Private & Shared/SLE/notes.md');
  });
});

describe('ZipHandler in-memory text guard', () => {
  it('rejects a zip that holds more decoded text than the cap', async () => {
    const big = 'x'.repeat(3 * 1024);
    const zip = buildZip({ 'a.html': big });

    const handler = new ZipHandler(10, 2 * 1024);

    await expect(handler.build(zip, true, new CardOption({}))).rejects.toThrow(
      /too large to process/
    );
  });

  it('accepts a zip whose text stays under the cap', async () => {
    const zip = buildZip({ 'a.html': 'x'.repeat(1024) });

    const handler = new ZipHandler(10, 8 * 1024);
    await handler.build(zip, true, new CardOption({}));

    expect(handler.getFileNames()).toEqual(['a.html']);
  });

  it('accumulates text across nested zips', async () => {
    const inner = buildZip({ 'big.html': 'x'.repeat(4 * 1024) });
    const outer = zipSync({ 'nested.zip': inner }, { level: 0 });

    const handler = new ZipHandler(10, 2 * 1024);
    await expect(
      handler.build(outer, true, new CardOption({}))
    ).rejects.toThrow(/too large to process/);
  });
});

describe('ZipHandler decompressed-size ceiling', () => {
  it('rejects a highly-compressible zip that decompresses past the ceiling before inflating it', async () => {
    const highlyCompressible = 'a'.repeat(64 * 1024);
    const zip = buildZip({ 'bomb.html': highlyCompressible });
    // The compressed archive is a tiny fraction of its decompressed size — a
    // zip bomb's defining shape — so the compressed-size guard alone lets it in.
    expect(zip.length).toBeLessThan(highlyCompressible.length / 10);

    const handler = new ZipHandler(10, 8 * 1024 * 1024, 16 * 1024);
    await expect(handler.build(zip, true, new CardOption({}))).rejects.toThrow(
      /decompresses to over/
    );
    // Aborted in the filter before any entry was inflated into memory.
    expect(handler.files).toHaveLength(0);
  });

  it('accepts a zip whose decompressed size stays under the ceiling', async () => {
    const zip = buildZip({ 'a.html': 'a'.repeat(8 * 1024) });

    const handler = new ZipHandler(10, 8 * 1024 * 1024, 64 * 1024);
    await handler.build(zip, true, new CardOption({}));

    expect(handler.getFileNames()).toEqual(['a.html']);
  });

  it('enforces the decompressed ceiling across nested zips via a shared counter', async () => {
    const inner = buildZip({ 'big.html': 'a'.repeat(32 * 1024) });
    const outer = zipSync({ 'nested.zip': inner }, { level: 0 });

    const handler = new ZipHandler(10, 8 * 1024 * 1024, 16 * 1024);
    await expect(
      handler.build(outer, true, new CardOption({}))
    ).rejects.toThrow(/decompresses to over/);
  });
});

describe('ZipHandler memory ceilings derive from the worker heap cap', () => {
  it('sets the in-memory text ceiling to half the worker old-gen cap, not a 4 GB literal', () => {
    const workerBytes = MAX_OLD_GENERATION_SIZE_MB * 1024 * 1024;
    expect(MAX_IN_MEMORY_BYTES).toBe(Math.floor(workerBytes * 0.5));
    expect(MAX_IN_MEMORY_BYTES).toBeLessThan(workerBytes);
    expect(MAX_IN_MEMORY_BYTES).not.toBe(4 * 1024 * 1024 * 1024);
  });

  it('bounds total extraction by disk budget, comfortably above real large exports', () => {
    // The old ceiling was 0.6× the worker heap (~614MB) because the whole
    // archive inflated into memory at once; batched extraction moved the bound
    // to disk. It must clear the real 643MB paying-user export that motivated
    // the change, and stay a finite named budget.
    expect(MAX_EXTRACTED_BYTES).toBeGreaterThan(700 * 1024 * 1024);
    expect(MAX_EXTRACTED_BYTES).toBe(4 * 1024 * 1024 * 1024);
  });

  it('keeps the per-batch extraction budget far below the worker heap cap', () => {
    const workerBytes = MAX_OLD_GENERATION_SIZE_MB * 1024 * 1024;
    expect(MAX_BATCH_EXTRACT_BYTES).toBeLessThan(workerBytes / 4);
  });
});

describe('ZipHandler batched extraction', () => {
  it('extracts every binary across multiple batches when the batch budget is tiny', async () => {
    const spill = makeSpillDir();
    const zip = buildBinaryZip({
      'a.png': 4096,
      'b.png': 4096,
      'c.png': 4096,
      'd.png': 4096,
    });

    // Batch budget of 5KB forces ~4 passes; every entry must still land intact.
    const handler = new ZipHandler(10, 1024, 1024 * 1024, 5 * 1024);
    await handler.build(zip, true, new CardOption({}), spill);

    expect(handler.getFileNames().sort()).toEqual([
      'a.png',
      'b.png',
      'c.png',
      'd.png',
    ]);
    for (const name of ['a.png', 'b.png', 'c.png', 'd.png']) {
      const entry = handler.files.find((f) => f.name === name);
      expect(Buffer.from(entry!.contents as Buffer)).toEqual(
        Buffer.alloc(4096, 1)
      );
    }
  });

  it('records the declared size on spilled entries so length reads need no disk hit', async () => {
    const spill = makeSpillDir();
    const zip = buildBinaryZip({ 'img.png': 2048 });

    const handler = new ZipHandler(10);
    await handler.build(zip, true, new CardOption({}), spill);

    const entry = handler.files.find((f) => f.name === 'img.png');
    expect(entry?.size).toBe(2048);
  });

  it('aborts a bomb at the census with nothing inflated and nothing spilled', async () => {
    const spill = makeSpillDir();
    const highlyCompressible = 'a'.repeat(64 * 1024);
    const zip = buildZip({ 'bomb.html': highlyCompressible });

    const handler = new ZipHandler(10, 8 * 1024 * 1024, 16 * 1024);
    await expect(
      handler.build(zip, true, new CardOption({}), spill)
    ).rejects.toThrow(/decompresses to over/);

    expect(handler.files).toHaveLength(0);
    expect(fs.readdirSync(spill)).toHaveLength(0);
  });

  it('still recurses into nested zips arriving through a binary batch', async () => {
    const spill = makeSpillDir();
    const inner = buildZip({ 'inner.html': '<p>nested deck</p>' });
    const outer = zipSync(
      { 'nested.zip': inner, 'top.html': strToU8('<p>top</p>') },
      { level: 0 }
    );

    const handler = new ZipHandler(10);
    await handler.build(outer, true, new CardOption({}), spill);

    const names = handler.getFileNames();
    expect(names).toContain('top.html');
    expect(names).toContain('inner.html');
  });
});

describe('ZipHandler disk spill', () => {
  it('spills binary entries to the workspace and reads them back lazily', async () => {
    const spill = makeSpillDir();
    const zip = buildBinaryZip({ 'img.png': 2048 });

    const handler = new ZipHandler(10);
    await handler.build(zip, true, new CardOption({}), spill);

    // The bytes live on disk, not in the in-memory entry's own storage.
    expect(fs.existsSync(path.join(spill, 'img.png'))).toBe(true);
    const entry = handler.files.find((f) => f.name === 'img.png');
    expect(entry).toBeDefined();
    expect(Buffer.from(entry!.contents as Buffer)).toEqual(
      Buffer.alloc(2048, 1)
    );
  });

  it('does not count spilled binary bytes toward the in-memory cap', async () => {
    const spill = makeSpillDir();
    // 8 KB of images with a tiny 1 KB in-memory cap: must NOT throw, because
    // the images go to disk instead of memory.
    const zip = buildBinaryZip({ 'a.png': 4096, 'b.png': 4096 });

    const handler = new ZipHandler(10, 1024);
    await handler.build(zip, true, new CardOption({}), spill);

    expect(handler.getFileNames()).toEqual(
      expect.arrayContaining(['a.png', 'b.png'])
    );
  });

  it('keeps html in memory as a decoded string, not a disk path', async () => {
    const spill = makeSpillDir();
    const zip = buildZip({ 'page.html': '<p>real deck</p>' });

    const handler = new ZipHandler(10);
    await handler.build(zip, true, new CardOption({}), spill);

    const entry = handler.files.find((f) => f.name === 'page.html');
    expect(entry?.contents).toBe('<p>real deck</p>');
    expect(fs.existsSync(path.join(spill, 'page.html'))).toBe(false);
  });
});

describe('ZipHandler incomplete archives (#4028)', () => {
  // A file grabbed mid-download or mid-sync ends before its central
  // directory, so fflate throws code 13 and the bsdtar fallback runs.
  function truncated(zip: Uint8Array): Uint8Array {
    return zip.slice(0, zip.length - 30);
  }

  beforeEach(() => {
    mockedFallback.mockReset();
  });

  it('tells the user the zip is incomplete when nothing can be recovered', async () => {
    mockedFallback.mockResolvedValue([]);
    const handler = new ZipHandler(10);

    await expect(
      handler.build(
        truncated(buildZip({ 'page.html': '<p>hi</p>' })),
        false,
        new CardOption({}),
        makeSpillDir()
      )
    ).rejects.toThrow(INCOMPLETE_ZIP_MESSAGE);
  });

  it('still reports incomplete when the fallback recovers a nested zip that is also truncated', async () => {
    mockedFallback.mockResolvedValueOnce([
      {
        name: '/tmp/workspaces/x/ExportBlock-abc-Part-1.zip',
        contents: truncated(buildZip({ 'Inner Page.html': '<p>lost</p>' })),
      },
    ]);
    // The recovered nested zip fails its own unzip and re-enters the
    // fallback, which recovers nothing further from the stump.
    mockedFallback.mockResolvedValueOnce([]);
    const handler = new ZipHandler(10);

    await expect(
      handler.build(
        truncated(buildZip({ 'page.html': '<p>hi</p>' })),
        false,
        new CardOption({}),
        makeSpillDir()
      )
    ).rejects.toThrow(INCOMPLETE_ZIP_MESSAGE);
  });

  it('recurses into a complete nested zip the fallback recovered', async () => {
    const inner = buildZip({ 'Recovered Page.html': '<p>saved</p>' });
    mockedFallback.mockResolvedValue([
      { name: '/tmp/workspaces/x/ExportBlock-abc-Part-1.zip', contents: inner },
    ]);
    const handler = new ZipHandler(10);

    await handler.build(
      truncated(buildZip({ 'page.html': '<p>hi</p>' })),
      false,
      new CardOption({}),
      makeSpillDir()
    );

    expect(handler.getFileNames()).toContain('Recovered Page.html');
  });

  it('counts recovered text against the upload memory budget', async () => {
    mockedFallback.mockResolvedValue([
      { name: 'page.html', contents: 'x'.repeat(4096) },
    ]);
    const handler = new ZipHandler(10, 2 * 1024);

    await expect(
      handler.build(
        truncated(buildZip({ 'page.html': '<p>hi</p>' })),
        false,
        new CardOption({}),
        makeSpillDir()
      )
    ).rejects.toThrow('too large to process');
  });

  it('leaves a recovered file on disk until something reads it', async () => {
    const read = vi.fn(() => strToU8('png bytes'));
    const onDisk = { name: 'photo.png', size: 9 };
    Object.defineProperty(onDisk, 'contents', { enumerable: true, get: read });
    mockedFallback.mockResolvedValue([
      onDisk,
      { name: 'page.html', contents: '<p>recovered</p>' },
    ]);
    const handler = new ZipHandler(10);

    await handler.build(
      truncated(buildZip({ 'page.html': '<p>hi</p>' })),
      false,
      new CardOption({}),
      makeSpillDir()
    );

    expect(handler.getFileNames()).toEqual(['photo.png', 'page.html']);
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps directly recovered supported files without throwing', async () => {
    mockedFallback.mockResolvedValue([
      {
        name: '/tmp/workspaces/x/Private & Shared/Page abc.html',
        contents: strToU8('<p>recovered</p>'),
      },
    ]);
    const handler = new ZipHandler(10);

    await handler.build(
      truncated(buildZip({ 'page.html': '<p>hi</p>' })),
      false,
      new CardOption({}),
      makeSpillDir()
    );

    expect(handler.getFileNames()).toEqual(
      expect.arrayContaining([
        '/tmp/workspaces/x/Private & Shared/Page abc.html',
      ])
    );
  });
});

describe('ZipHandler damaged archives', () => {
  // The zip's index is intact but an entry's compressed data is not, so
  // fflate reads the census and then throws an inflate error mid-pass.
  function dataStart(zip: Uint8Array, name: string): number {
    const nameBytes = strToU8(name);
    for (let i = 0; i + 30 < zip.length; i++) {
      const isLocalHeader =
        zip[i] === 0x50 &&
        zip[i + 1] === 0x4b &&
        zip[i + 2] === 0x03 &&
        zip[i + 3] === 0x04;
      const nameLength = zip[i + 26] | (zip[i + 27] << 8);
      const extraLength = zip[i + 28] | (zip[i + 29] << 8);
      const nameMatches =
        nameLength === nameBytes.length &&
        nameBytes.every((byte, j) => zip[i + 30 + j] === byte);
      if (isLocalHeader && nameMatches) {
        return i + 30 + nameLength + extraLength;
      }
    }
    throw new Error(`no local header for ${name}`);
  }

  function damaged(
    zip: Uint8Array,
    name: string,
    offset: number,
    value: number
  ): Uint8Array {
    const copy = zip.slice();
    copy[dataStart(zip, name) + offset] = value;
    return copy;
  }

  const longPage = '<p>' + 'flashcard '.repeat(400) + '</p>';

  beforeEach(() => {
    mockedFallback.mockReset();
  });

  it.each([
    ['an invalid block type', 0, 0xff],
    ['an early end of stream', 1, 0xff],
    ['an invalid length', 2, 0x00],
  ])(
    'says the zip is damaged, not the unzip error, for %s',
    async (_label, offset, value) => {
      mockedFallback.mockResolvedValue([]);
      const zip = zipSync({ 'page.html': strToU8(longPage) }, { level: 9 });
      const handler = new ZipHandler(10);

      const failure = handler.build(
        damaged(zip, 'page.html', offset, value),
        false,
        new CardOption({}),
        makeSpillDir()
      );

      await expect(failure).rejects.toThrow(DAMAGED_ZIP_MESSAGE);
      await expect(failure).rejects.toMatchObject({
        name: 'IncompleteZipError',
      });
    }
  );

  it('keeps what the fallback recovers, without the entries read before the damage', async () => {
    const zip = zipSync(
      {
        'page.html': strToU8('<p>intact</p>'),
        'picture.png': strToU8(longPage),
      },
      { level: 9 }
    );
    mockedFallback.mockResolvedValue([
      { name: 'page.html', contents: '<p>intact</p>' },
    ]);
    const handler = new ZipHandler(10);

    await handler.build(
      damaged(zip, 'picture.png', 0, 0xff),
      false,
      new CardOption({}),
      makeSpillDir()
    );

    expect(mockedFallback).toHaveBeenCalledTimes(1);
    expect(handler.getFileNames()).toEqual(['page.html']);
  });

  it('keeps the outer pages when a nested zip is damaged and nothing in it can be recovered', async () => {
    const inner = damaged(
      zipSync({ 'inner.html': strToU8(longPage) }, { level: 9 }),
      'inner.html',
      0,
      0xff
    );
    const outer = zipSync({
      'page.html': strToU8('<p>outer</p>'),
      'part.zip': inner,
    });
    mockedFallback.mockResolvedValue([]);
    const handler = new ZipHandler(10);

    await handler.build(outer, false, new CardOption({}), makeSpillDir());

    expect(mockedFallback).toHaveBeenCalledTimes(1);
    expect(mockedFallback.mock.calls[0][0]).toEqual(inner);
    expect(handler.getFileNames()).toEqual(['page.html']);
  });

  it('says the zip is damaged when its only content is a damaged nested zip', async () => {
    const inner = damaged(
      zipSync({ 'inner.html': strToU8(longPage) }, { level: 9 }),
      'inner.html',
      0,
      0xff
    );
    mockedFallback.mockResolvedValue([]);
    const handler = new ZipHandler(10);

    await expect(
      handler.build(
        zipSync({ 'part.zip': inner }),
        false,
        new CardOption({}),
        makeSpillDir()
      )
    ).rejects.toThrow(DAMAGED_ZIP_MESSAGE);
  });

  it('does not let the fallback open more nested zips than the limit allows', async () => {
    const part = zipSync({ 'part.html': strToU8('<p>part</p>') });
    const zip = zipSync(
      { 'a-part.zip': part, 'z-notes.pdf': strToU8(longPage) },
      { level: 9 }
    );
    mockedFallback.mockResolvedValue([{ name: 'a-part.zip', contents: part }]);
    // One entry per batch, so the part opens before the damaged entry inflates.
    const handler = new ZipHandler(
      2,
      MAX_IN_MEMORY_BYTES,
      MAX_EXTRACTED_BYTES,
      1
    );

    await expect(
      handler.build(
        damaged(zip, 'z-notes.pdf', 0, 0xff),
        false,
        new CardOption({}),
        makeSpillDir()
      )
    ).rejects.toThrow(DAMAGED_ZIP_MESSAGE);
    expect(handler.zipFileCount).toBe(2);
  });

  it('keeps the photo text an image quiz already read when a later entry is damaged', async () => {
    const zip = zipSync(
      { 'photo.png': strToU8('png bytes'), 'notes.pdf': strToU8(longPage) },
      { level: 9 }
    );
    mockedFallback.mockResolvedValue([
      { name: 'page.html', contents: '<p>recovered</p>' },
    ]);
    const handler = new ZipHandler(10);

    await handler.build(
      damaged(zip, 'notes.pdf', 0, 0xff),
      true,
      new CardOption({ 'image-quiz-html-to-anki': 'true' }),
      makeSpillDir()
    );

    const names = handler.getFileNames();
    expect(names).toEqual([
      'page.html',
      expect.stringMatching(/^ocr-.+\.html$/),
    ]);
    expect(handler.files[1].contents).toContain('<p>read from the photo</p>');
  });

  it('builds the image quiz from the photo text when the fallback recovers only photos', async () => {
    const zip = zipSync(
      { 'photo.png': strToU8('png bytes'), 'notes.pdf': strToU8(longPage) },
      { level: 9 }
    );
    mockedFallback.mockResolvedValue([
      { name: 'photo.png', contents: strToU8('png bytes') },
    ]);
    const handler = new ZipHandler(10);

    await handler.build(
      damaged(zip, 'notes.pdf', 0, 0xff),
      true,
      new CardOption({ 'image-quiz-html-to-anki': 'true' }),
      makeSpillDir()
    );

    expect(handler.getFileNames()).toEqual([
      'photo.png',
      expect.stringMatching(/^ocr-.+\.html$/),
    ]);
  });

  it("writes a nested zip's photo text once, not again for the zip around it", async () => {
    const inner = zipSync({ 'photo.png': strToU8('png bytes') });
    const handler = new ZipHandler(10);

    await handler.build(
      zipSync({ 'part.zip': inner }),
      true,
      new CardOption({ 'image-quiz-html-to-anki': 'true' }),
      makeSpillDir()
    );

    const ocrFiles = handler.files.filter((f) => f.name.startsWith('ocr-'));
    expect(ocrFiles).toHaveLength(1);
    expect(ocrFiles[0].contents).toContain('<p>read from the photo</p>');
  });

  it("keeps a nested zip's photo text when the zip around it is damaged later", async () => {
    const part = zipSync({ 'inner-photo.png': strToU8('inner png bytes') });
    const zip = zipSync(
      {
        'photo.png': strToU8('png bytes'),
        'a-part.zip': part,
        'z-notes.pdf': strToU8(longPage),
      },
      { level: 9 }
    );
    mockedFallback.mockResolvedValue([{ name: 'a-part.zip', contents: part }]);
    const convert = vi.mocked(convertImageToHTML);
    convert.mockClear();
    // One entry per batch, so the part opens before the damaged entry inflates.
    const handler = new ZipHandler(
      10,
      MAX_IN_MEMORY_BYTES,
      MAX_EXTRACTED_BYTES,
      1
    );

    await handler.build(
      damaged(zip, 'z-notes.pdf', 0, 0xff),
      true,
      new CardOption({ 'image-quiz-html-to-anki': 'true' }),
      makeSpillDir()
    );

    const ocrFiles = handler.files.filter((f) => f.name.startsWith('ocr-'));
    expect(ocrFiles).toHaveLength(1);
    expect(convert).toHaveBeenCalledTimes(2);
    expect(
      String(ocrFiles[0].contents).split('<p>read from the photo</p>')
    ).toHaveLength(3);
  });

  it('reads two entries holding the same photo twice, as before', async () => {
    const convert = vi.mocked(convertImageToHTML);
    convert.mockClear();
    const handler = new ZipHandler(10);

    await handler.build(
      zipSync({
        'front.png': strToU8('same png bytes'),
        'copy.png': strToU8('same png bytes'),
      }),
      true,
      new CardOption({ 'image-quiz-html-to-anki': 'true' }),
      makeSpillDir()
    );

    const ocrFiles = handler.files.filter((f) => f.name.startsWith('ocr-'));
    expect(convert).toHaveBeenCalledTimes(2);
    expect(ocrFiles).toHaveLength(1);
    expect(
      String(ocrFiles[0].contents).split('<p>read from the photo</p>')
    ).toHaveLength(3);
  });

  it.each([
    [
      'a photo and the same photo in a nested zip',
      {
        'photo.png': strToU8('same png bytes'),
        'part.zip': zipSync({ 'photo.png': strToU8('same png bytes') }),
      },
    ],
    [
      'two copies of the same nested zip',
      {
        'part-1.zip': zipSync({ 'photo.png': strToU8('same png bytes') }),
        'part-2.zip': zipSync({ 'photo.png': strToU8('same png bytes') }),
      },
    ],
  ])('reads %s twice, as before', async (_label, entries) => {
    const convert = vi.mocked(convertImageToHTML);
    convert.mockClear();
    const handler = new ZipHandler(10);

    await handler.build(
      zipSync(entries),
      true,
      new CardOption({ 'image-quiz-html-to-anki': 'true' }),
      makeSpillDir()
    );

    const ocrFiles = handler.files.filter((f) => f.name.startsWith('ocr-'));
    expect(convert).toHaveBeenCalledTimes(2);
    expect(
      String(ocrFiles[0].contents).split('<p>read from the photo</p>')
    ).toHaveLength(3);
  });

  it('still throws an error that is not a damaged zip as it is', async () => {
    const zip = zipSync({ 'page.html': strToU8(longPage) }, { level: 9 });
    const handler = new ZipHandler(10, 1024 * 1024, 10);

    await expect(
      handler.build(zip, false, new CardOption({}), makeSpillDir())
    ).rejects.toThrow('decompresses to over');
    expect(mockedFallback).not.toHaveBeenCalled();
  });
});
