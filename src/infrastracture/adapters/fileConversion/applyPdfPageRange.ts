import fs from 'node:fs';
import type { File } from '../../../lib/zip/zip';
import { isPDFFile } from '../../../lib/storage/checks';
import { getPageCount } from '../../../lib/pdf/getPageCount';
import { resolveSafeEntryPath } from '../../../lib/vocab/safeEntryPath';
import {
  parsePdfPageRange,
  resolvePdfPages,
  PdfPageRangeError,
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

function primaryPdfBytes(file: File, primaryName: string): Buffer | null {
  if (file.name !== primaryName || !isPDFFile(file.name)) return null;
  if (Buffer.isBuffer(file.contents)) return file.contents;
  if (file.contents instanceof Uint8Array) return Buffer.from(file.contents);
  return null;
}

async function pageCountOrLockedError(
  adapters: PdfPageRangeAdapters,
  buffer: Buffer,
  workspaceLocation: string
): Promise<number> {
  try {
    return await adapters.getPageCount(buffer, workspaceLocation);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('pdfinfo_password')
    ) {
      throw new PdfPageRangeError(
        "Page ranges don't work on password-protected PDFs. Clear Pages to convert the whole file."
      );
    }
    throw error;
  }
}

// The single choke point for the Pages card option. Only the top-level uploaded
// PDF (the file whose name is the one being converted) is sliced, so a range
// never touches PDFs pulled into a Notion export by getRelevantFiles; a
// standalone PDF that is itself the converted file (a direct upload, or a PDF
// content file in a zip) is sliced. Slicing happens up front so text, page
// images, page pairs and AI all inherit the range and AI credits drop with it.
// A malformed range, a page past the end, or a password-protected PDF throws
// PdfPageRangeError, which the upload surfaces as a clear message; it never
// silently converts the whole file. Ranges expand only after the real page
// count is known, so a hostile value cannot drive an unbounded allocation or
// spawn.
export async function applyPdfPageRange(
  files: File[],
  pageRange: string | undefined,
  userId: number | null,
  workspaceLocation: string,
  primaryName: string,
  adapters: PdfPageRangeAdapters = defaultAdapters
): Promise<File[]> {
  if (pageRange == null || pageRange.trim() === '') {
    return files;
  }
  if (!files.some((file) => primaryPdfBytes(file, primaryName) != null)) {
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
    const buffer = primaryPdfBytes(file, primaryName);
    if (buffer == null) {
      result.push(file);
      continue;
    }
    const pageCount = await pageCountOrLockedError(
      adapters,
      buffer,
      workspaceLocation
    );
    const pages = resolvePdfPages(segments, pageCount);
    const sliced = await adapters.extract(
      buffer,
      pages,
      pageCount,
      workspaceLocation
    );
    result.push({ ...file, contents: sliced, size: sliced.length });
    slicedPdfCount += 1;
    requestedPages += pages.length;
  }

  if (slicedPdfCount > 0) {
    track('pdf_page_range_used', {
      userId,
      props: { requested_pages: requestedPages, pdf_count: slicedPdfCount },
    });
  }

  return result;
}
