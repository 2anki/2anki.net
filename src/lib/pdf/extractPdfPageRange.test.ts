import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { extractPdfPageRange, PdfPageRangeRunner } from './extractPdfPageRange';

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
  it('separates across the full span and unites only the requested pages in order', async () => {
    const runner = fakeRunner();
    const result = await extractPdfPageRange(
      Buffer.from('%PDF'),
      [2, 4],
      runner
    );

    expect(result.toString()).toBe('PAGE:2\nPAGE:4\n');
    expect(runner.separate).toHaveBeenCalledTimes(1);
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
    const result = await extractPdfPageRange(Buffer.from('%PDF'), [3], runner);

    expect(result.toString()).toBe('PAGE:3\n');
    expect(runner.unite).not.toHaveBeenCalled();
  });

  it('throws when asked for no pages', async () => {
    await expect(
      extractPdfPageRange(Buffer.from('%PDF'), [], fakeRunner())
    ).rejects.toThrow();
  });
});
