import fs from 'node:fs';
import type { File } from '../../../lib/zip/zip';
import { isPDFFile } from '../../../lib/storage/checks';
import { getPageCount } from '../../../lib/pdf/getPageCount';
import { resolveSafeEntryPath } from '../../../lib/vocab/safeEntryPath';
import {
  parsePdfPageRange,
  resolvePdfPages,
  PdfPageSegment,
} from '../../../lib/pdf/pdfPageRange';
import { extractPdfPageRange } from '../../../lib/pdf/extractPdfPageRange';
import { track } from '../../../services/events/track';

export interface PdfPageRangeAdapters {
  getPageCount(pdf: Buffer, workspaceLocation: string): Promise<number>;
  extract(
    pdf: Buffer,
    pages: number[],
    pageCount: number,
    workspaceLocation: string
  ): Promise<Buffer>;
}

async function pageCountFromBuffer(
  pdf: Buffer,
  workspaceLocation: string
): Promise<number> {
  const dir = await fs.promises.mkdtemp(
    resolveSafeEntryPath('pdf-page-count-', workspaceLocation)
  );
  try {
    const pdfPath = resolveSafeEntryPath('input.pdf', dir);
    await fs.promises.writeFile(pdfPath, pdf);
    return await getPageCount(pdfPath);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

const defaultAdapters: PdfPageRangeAdapters = {
  getPageCount: pageCountFromBuffer,
  extract: extractPdfPageRange,
};

function pdfBytes(file: File): Buffer | null {
  if (!isPDFFile(file.name)) return null;
  if (Buffer.isBuffer(file.contents)) return file.contents;
  if (file.contents instanceof Uint8Array) return Buffer.from(file.contents);
  return null;
}

// The single choke point for the Pages card option. Every PDF the user chose a
// range for is sliced down to those pages up front, so text, page images, page
// pairs and AI all inherit the range and AI credits drop with it. A malformed
// range or a page past the end of the document throws PdfPageRangeError, which
// the upload surfaces as a clear message; it never silently converts the whole
// file instead. A range set with no PDF in the upload is ignored so a stale
// value never fails an unrelated upload. Ranges are only expanded after the
// real page count is known, so a hostile value cannot drive an unbounded
// allocation or spawn.
export async function applyPdfPageRange(
  files: File[],
  pageRange: string | undefined,
  userId: number | null,
  workspaceLocation: string,
  adapters: PdfPageRangeAdapters = defaultAdapters
): Promise<File[]> {
  if (pageRange == null || pageRange.trim() === '') {
    return files;
  }
  if (!files.some((file) => pdfBytes(file) != null)) {
    return files;
  }

  const segments: PdfPageSegment[] | null = parsePdfPageRange(pageRange);
  if (segments == null) {
    return files;
  }

  let slicedPdfCount = 0;
  let requestedPages = 0;
  const result: File[] = [];
  for (const file of files) {
    const buffer = pdfBytes(file);
    if (buffer == null) {
      result.push(file);
      continue;
    }
    const pageCount = await adapters.getPageCount(buffer, workspaceLocation);
    const pages = resolvePdfPages(segments, pageCount);
    const sliced = await adapters.extract(
      buffer,
      pages,
      pageCount,
      workspaceLocation
    );
    result.push({ ...file, contents: sliced, size: sliced.length });
    slicedPdfCount += 1;
    requestedPages = pages.length;
  }

  if (slicedPdfCount > 0) {
    track('pdf_page_range_used', {
      userId,
      props: { requested_pages: requestedPages, pdf_count: slicedPdfCount },
    });
  }

  return result;
}
