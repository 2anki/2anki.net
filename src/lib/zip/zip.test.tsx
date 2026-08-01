import fs from 'fs';
import os from 'os';
import path from 'path';
import { strToU8, zipSync } from 'fflate';

import {
  ZipHandler,
  MAX_IN_MEMORY_BYTES,
  MAX_EXTRACTED_BYTES,
  MAX_BATCH_EXTRACT_BYTES,
} from './zip';
import { MAX_OLD_GENERATION_SIZE_MB } from '../conversionMemoryLimits';
import CardOption from '../parser/Settings';

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
