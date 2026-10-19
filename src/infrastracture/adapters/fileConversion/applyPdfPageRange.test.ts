import { describe, expect, it, vi } from 'vitest';
import type { File } from '../../../lib/zip/zip';
import { applyPdfPageRange, PdfPageRangeAdapters } from './applyPdfPageRange';

const WORKSPACE = '/tmp/does-not-matter';

function adapters(pageCount: number): PdfPageRangeAdapters {
  return {
    getPageCount: vi.fn(async () => pageCount),
    extract: vi.fn(async (_pdf: Buffer, pages: number[]) =>
      Buffer.from(`SLICED:${pages.join('-')}`)
    ),
  };
}

function lockedAdapters(): PdfPageRangeAdapters {
  return {
    getPageCount: vi.fn(async () => {
      throw new Error('pdfinfo_password path=notes.pdf');
    }),
    extract: vi.fn(async () => Buffer.from('unreached')),
  };
}

const pdf = (name: string, bytes: string): File => ({
  name,
  contents: Buffer.from(bytes),
});

describe('applyPdfPageRange', () => {
  it('replaces the primary PDF contents with only the selected pages', async () => {
    const deps = adapters(50);
    const files = [pdf('notes.pdf', '%PDF-full')];

    const result = await applyPdfPageRange(
      files,
      '2-3, 10',
      7,
      WORKSPACE,
      'notes.pdf',
      deps
    );

    expect(result[0].contents?.toString()).toBe('SLICED:2-3-10');
    expect(result[0].size).toBe('SLICED:2-3-10'.length);
    expect(deps.extract).toHaveBeenCalledWith(
      expect.any(Buffer),
      [2, 3, 10],
      50,
      WORKSPACE
    );
  });

  it('slices only the primary PDF, never embedded media pulled in alongside it', async () => {
    const deps = adapters(50);
    const html = { name: 'page.html', contents: Buffer.from('<html>') };
    const embedded = pdf('page/attachment.pdf', '%PDF-embedded');
    const files = [html, embedded];

    const result = await applyPdfPageRange(
      files,
      '2-3',
      7,
      WORKSPACE,
      'page.html',
      deps
    );

    expect(result).toBe(files);
    expect(deps.getPageCount).not.toHaveBeenCalled();
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('returns the files unchanged when the range is empty', async () => {
    const deps = adapters(50);
    const files = [pdf('notes.pdf', '%PDF-full')];

    const result = await applyPdfPageRange(
      files,
      '  ',
      7,
      WORKSPACE,
      'notes.pdf',
      deps
    );

    expect(result).toBe(files);
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('ignores a range when the primary file is not a PDF', async () => {
    const deps = adapters(50);
    const files = [{ name: 'page.html', contents: Buffer.from('<html>') }];

    const result = await applyPdfPageRange(
      files,
      'nonsense',
      7,
      WORKSPACE,
      'page.html',
      deps
    );

    expect(result).toBe(files);
    expect(deps.getPageCount).not.toHaveBeenCalled();
  });

  it('fails with a clear message when a page is past the end of the PDF', async () => {
    const deps = adapters(98);
    const files = [pdf('notes.pdf', '%PDF-full')];

    await expect(
      applyPdfPageRange(files, '120-130', 7, WORKSPACE, 'notes.pdf', deps)
    ).rejects.toThrow('past the end of this 98-page PDF');
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('fails with a clear message when the range is malformed and the primary is a PDF', async () => {
    const deps = adapters(98);
    const files = [pdf('notes.pdf', '%PDF-full')];

    await expect(
      applyPdfPageRange(files, 'chapter two', 7, WORKSPACE, 'notes.pdf', deps)
    ).rejects.toThrow('not a valid page or range');
  });

  it('rejects a password-protected PDF with a clear message', async () => {
    const deps = lockedAdapters();
    const files = [pdf('notes.pdf', '%PDF-locked')];

    await expect(
      applyPdfPageRange(files, '2-3', 7, WORKSPACE, 'notes.pdf', deps)
    ).rejects.toThrow('password-protected');
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it('does not expand a hostile huge range; it is rejected against the page count', async () => {
    const deps = adapters(10);
    const files = [pdf('notes.pdf', '%PDF-full')];

    await expect(
      applyPdfPageRange(files, '1-999999', 7, WORKSPACE, 'notes.pdf', deps)
    ).rejects.toThrow('past the end of this 10-page PDF');
    expect(deps.extract).not.toHaveBeenCalled();
  });
});
