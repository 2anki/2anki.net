import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractPdfPageRange,
  PdfPageRangeRunner,
  runPdfTool,
} from './extractPdfPageRange';
import { PAYING_MAX_UPLOAD_SIZE } from '../misc/getUploadLimits';

// A fake poppler that writes one recognisable file per page in the range and
// concatenates the selected files on unite, so the returned bytes reveal which
// pages were chosen and in what order.
function fakeRunner(): PdfPageRangeRunner {
  return {
    separate: vi.fn(async (_inputPath, outputPattern, first, last) => {
      for (let page = first; page <= last; page++) {
        const target = outputPattern.replace('%d', String(page));
        await fs.promises.writeFile(target, `PAGE:${page}\n`);
      }
    }),
    unite: vi.fn(async (inputPaths: string[], outputPath: string) => {
      const parts = await Promise.all(
        inputPaths.map((p) => fs.promises.readFile(p))
      );
      await fs.promises.writeFile(outputPath, Buffer.concat(parts));
    }),
  };
}

describe('extractPdfPageRange', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'page-range-ws-')
    );
  });

  afterEach(async () => {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  });

  it('separates across the full span and unites only the requested pages in order', async () => {
    const runner = fakeRunner();
    const result = await extractPdfPageRange(
      Buffer.from('%PDF'),
      [2, 4],
      10,
      workspace,
      runner
    );

    expect(result.toString()).toBe('PAGE:2\nPAGE:4\n');
    const separateArgs = (runner.separate as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(separateArgs[2]).toBe(2);
    expect(separateArgs[3]).toBe(4);
    const uniteArgs = (runner.unite as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(uniteArgs[0].map((p: string) => path.basename(p))).toEqual([
      'out-2.pdf',
      'out-4.pdf',
    ]);
  });

  it('returns the lone separated page without uniting for a single page', async () => {
    const runner = fakeRunner();
    const result = await extractPdfPageRange(
      Buffer.from('%PDF'),
      [3],
      10,
      workspace,
      runner
    );

    expect(result.toString()).toBe('PAGE:3\n');
    expect(runner.unite).not.toHaveBeenCalled();
  });

  it('writes its temp files inside the workspace and cleans them up', async () => {
    const runner = fakeRunner();
    await extractPdfPageRange(
      Buffer.from('%PDF'),
      [2, 3],
      10,
      workspace,
      runner
    );

    const inputPathArg = (runner.separate as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(inputPathArg.startsWith(workspace + path.sep)).toBe(true);
    expect(await fs.promises.readdir(workspace)).toEqual([]);
  });

  it('throws when asked for no pages', async () => {
    await expect(
      extractPdfPageRange(Buffer.from('%PDF'), [], 10, workspace, fakeRunner())
    ).rejects.toThrow();
  });

  it('rejects a selection that reaches past the real page count', async () => {
    const runner = fakeRunner();
    await expect(
      extractPdfPageRange(Buffer.from('%PDF'), [5], 3, workspace, runner)
    ).rejects.toThrow('exceeds the PDF page count');
    expect(runner.separate).not.toHaveBeenCalled();
  });

  it('rejects a buffer larger than the upload ceiling before touching the disk', async () => {
    const runner = fakeRunner();
    const oversized = {
      length: PAYING_MAX_UPLOAD_SIZE + 1,
    } as unknown as Buffer;
    await expect(
      extractPdfPageRange(oversized, [1], 10, workspace, runner)
    ).rejects.toThrow('too large');
    expect(runner.separate).not.toHaveBeenCalled();
  });
});

describe('runPdfTool', () => {
  it('kills a subprocess that overruns the timeout', async () => {
    await expect(runPdfTool('/bin/sleep', ['5'], 50)).rejects.toThrow(
      'timed out'
    );
  });

  it('resolves when the subprocess exits cleanly', async () => {
    await expect(
      runPdfTool('/bin/sleep', ['0'], 5000)
    ).resolves.toBeUndefined();
  });
});
