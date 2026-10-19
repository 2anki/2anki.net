import { describe, expect, it, vi } from 'vitest';
import type { File } from '../../../lib/zip/zip';
import { applyPdfPageRange, PdfPageRangeAdapters } from './applyPdfPageRange';

function adapters(pageCount: number): PdfPageRangeAdapters {
  return {
    getPageCount: vi.fn(async () => pageCount),
    extract: vi.fn(async (_pdf: Buffer, pages: number[]) =>
      Buffer.from(`SLICED:${pages.join('-')}`)
    ),
  };
}

const pdf = (name: string, bytes: string): File => ({
  name,
  contents: Buffer.from(bytes),
});

describe('applyPdfPageRange', () => {
  it('replaces the PDF contents with only the selected pages', async () => {
    const deps = adapters(50);
    const files = [pdf('notes.pdf', '%PDF-full')];

    const result = await applyPdfPageRange(files, '2-3, 10', 7, deps);

    expect(result[0].contents?.toString()).toBe('SLICED:2-3-10');
    expect(result[0].size).toBe('SLICED:2-3-10'.length);
    expect(deps.extract).toHaveBeenCalledWith(expect.any(Buffer), [2, 3, 10]);
  });

  it('leaves non-PDF files untouched while slicing the PDF', async () => {
    const deps = adapters(50);
    const html = { name: 'page.html', contents: Buffer.from('<html>') };
    const files = [html, pdf('notes.pdf', '%PDF-full')];

    const result = await applyPdfPageRange(files, '5', 7, deps);

    expect(result[0]).toBe(html);
    expect(result[1].contents?.toString()).toBe('SLICED:5');
  });

  it('returns the files unchanged when the range is empty', async () => {
    const deps = adapters(50);
    const files = [pdf('notes.pdf', '%PDF-full')];

    const result = await applyPdfPageRange(files, '  ', 7, deps);

    expect(result).toBe(files);
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('ignores a range when the upload has no PDF', async () => {
    const deps = adapters(50);
    const files = [{ name: 'page.html', contents: Buffer.from('<html>') }];

    const result = await applyPdfPageRange(files, 'nonsense', 7, deps);

    expect(result).toBe(files);
    expect(deps.getPageCount).not.toHaveBeenCalled();
  });

  it('fails with a clear message when a page is past the end of the PDF', async () => {
    const deps = adapters(98);
    const files = [pdf('notes.pdf', '%PDF-full')];

    await expect(applyPdfPageRange(files, '120-130', 7, deps)).rejects.toThrow(
      'past the end of this 98-page PDF'
    );
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('fails with a clear message when the range is malformed and a PDF is present', async () => {
    const deps = adapters(98);
    const files = [pdf('notes.pdf', '%PDF-full')];

    await expect(
      applyPdfPageRange(files, 'chapter two', 7, deps)
    ).rejects.toThrow('not a valid page or range');
  });
});
