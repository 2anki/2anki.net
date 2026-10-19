import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractPdfPageRange,
  PdfPageRangeRunner,
  runPdfTool,
} from './extractPdfPageRange';
import { isPdfPageRangeError } from './pdfPageRange';
import { PAYING_MAX_UPLOAD_SIZE } from '../misc/getUploadLimits';

// A fake poppler that honours -f/-l per call: each separate writes one file per
// page in that run only, so a sparse selection reveals a request for a giant
// span. Unite concatenates its inputs so the bytes show the chosen order.
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

const separateCalls = (runner: PdfPageRangeRunner) =>
  (runner.separate as ReturnType<typeof vi.fn>).mock.calls;
const uniteCalls = (runner: PdfPageRangeRunner) =>
  (runner.unite as ReturnType<typeof vi.fn>).mock.calls;

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

  it('separates a contiguous run once and unites in page order', async () => {
    const runner = fakeRunner();
    const result = await extractPdfPageRange(
      Buffer.from('%PDF'),
      [2, 3, 4],
      10,
      workspace,
      runner
    );

    expect(result.toString()).toBe('PAGE:2\nPAGE:3\nPAGE:4\n');
    expect(separateCalls(runner)).toHaveLength(1);
    expect(separateCalls(runner)[0].slice(2)).toEqual([2, 4]);
  });

  it('separates each run of a sparse selection without requesting a giant span', async () => {
    const runner = fakeRunner();
    const result = await extractPdfPageRange(
      Buffer.from('%PDF'),
      [1, 5000],
      5000,
      workspace,
      runner
    );

    expect(result.toString()).toBe('PAGE:1\nPAGE:5000\n');
    expect(separateCalls(runner)).toHaveLength(2);
    expect(separateCalls(runner).map((c) => c.slice(2))).toEqual([
      [1, 1],
      [5000, 5000],
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

  it('unites a large selection in batches so pdfunite never opens too many files at once', async () => {
    const runner = fakeRunner();
    const pages = Array.from({ length: 600 }, (_, i) => i + 1);
    const result = await extractPdfPageRange(
      Buffer.from('%PDF'),
      pages,
      600,
      workspace,
      runner
    );

    expect(result.toString().trim().split('\n')).toHaveLength(600);
    // 600 pages -> batches of 500 + 100, then one final merge of the two parts.
    expect(uniteCalls(runner)).toHaveLength(3);
    expect(uniteCalls(runner)[0][0]).toHaveLength(500);
    expect(uniteCalls(runner)[1][0]).toHaveLength(100);
    expect(uniteCalls(runner)[2][0]).toHaveLength(2);
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

    expect(separateCalls(runner)[0][0].startsWith(workspace + path.sep)).toBe(
      true
    );
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
  it('kills a subprocess that overruns the timeout and reports it as a page-range error', async () => {
    try {
      await runPdfTool('/bin/sleep', ['5'], 50);
      throw new Error('expected runPdfTool to reject');
    } catch (error) {
      expect(isPdfPageRangeError(error)).toBe(true);
      expect((error as Error).message).toContain('took too long');
    }
  });

  it('resolves when the subprocess exits cleanly', async () => {
    await expect(
      runPdfTool('/bin/sleep', ['0'], 5000)
    ).resolves.toBeUndefined();
  });
});
