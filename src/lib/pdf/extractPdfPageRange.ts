import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSafeEntryPath } from '../vocab/safeEntryPath';
import { PAYING_MAX_UPLOAD_SIZE } from '../misc/getUploadLimits';

// The buffer is already bounded by the multer upload cap; this is a
// defence-in-depth ceiling so a caller that bypasses the upload path can never
// hand page-range extraction an unbounded PDF. Equal to the largest upload any
// plan allows, so it never rejects a real upload.
const MAX_PDF_BYTES = PAYING_MAX_UPLOAD_SIZE;

// poppler is deterministic and fast on a bounded PDF; a run that has not
// finished in this window is pathological (a decompression bomb, a hung child)
// and is killed rather than left to pin a worker.
export const PDF_PAGE_RANGE_TIMEOUT_MS = 60_000;

const SEPARATE_BINARIES =
  os.platform() === 'darwin'
    ? ['/opt/homebrew/bin/pdfseparate', '/usr/local/bin/pdfseparate']
    : ['/usr/bin/pdfseparate'];

const UNITE_BINARIES =
  os.platform() === 'darwin'
    ? ['/opt/homebrew/bin/pdfunite', '/usr/local/bin/pdfunite']
    : ['/usr/bin/pdfunite'];

function resolveBinary(candidates: string[], fallback: string): string {
  return candidates.find((p) => fs.existsSync(p)) ?? fallback;
}

// argv array with shell:false (CWE-78) and a hard timeout. Every argument is
// an internal temp path or an integer page number, never a shell string.
export function runPdfTool(
  binary: string,
  args: string[],
  timeoutMs: number = PDF_PAGE_RANGE_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { shell: false });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(binary)} timed out`));
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(new Error(`${path.basename(binary)} exited with code ${code}`));
    });
  });
}

export interface PdfPageRangeRunner {
  separate(
    inputPath: string,
    outputPattern: string,
    first: number,
    last: number
  ): Promise<void>;
  unite(inputPaths: string[], outputPath: string): Promise<void>;
}

const popplerRunner: PdfPageRangeRunner = {
  separate: (inputPath, outputPattern, first, last) =>
    runPdfTool(resolveBinary(SEPARATE_BINARIES, 'pdfseparate'), [
      '-f',
      String(first),
      '-l',
      String(last),
      inputPath,
      outputPattern,
    ]),
  unite: (inputPaths, outputPath) =>
    runPdfTool(resolveBinary(UNITE_BINARIES, 'pdfunite'), [
      ...inputPaths,
      outputPath,
    ]),
};

// Extracts `pages` (1-based, sorted ascending, no duplicates) into a new PDF
// carrying only those pages, in order. poppler's pdfseparate writes one file
// per page named by its absolute page number, so a range of 2-4 produces
// out-2.pdf, out-3.pdf, out-4.pdf; pdfunite merges only the requested files. A
// single requested page needs no merge. Every temp file lives inside the
// upload's workspace (resolved through the zip-slip guard) and is removed in a
// finally. `pageCount` bounds the work: a selection longer than, or reaching
// past, the real document is rejected before any file is written.
export async function extractPdfPageRange(
  pdf: Buffer,
  pages: number[],
  pageCount: number,
  workspaceLocation: string,
  runner: PdfPageRangeRunner = popplerRunner
): Promise<Buffer> {
  if (pages.length === 0) {
    throw new Error('extractPdfPageRange requires at least one page');
  }
  if (pdf.length > MAX_PDF_BYTES) {
    throw new Error('PDF is too large for page-range extraction');
  }
  if (pages.length > pageCount || pages[pages.length - 1] > pageCount) {
    throw new Error('page selection exceeds the PDF page count');
  }

  const dir = await fs.promises.mkdtemp(
    resolveSafeEntryPath('pdf-page-range-', workspaceLocation)
  );
  try {
    const inputPath = resolveSafeEntryPath('input.pdf', dir);
    await fs.promises.writeFile(inputPath, pdf);

    const first = pages[0];
    const last = pages[pages.length - 1];
    await runner.separate(
      inputPath,
      resolveSafeEntryPath('out-%d.pdf', dir),
      first,
      last
    );

    const selectedPaths = pages.map((page) =>
      resolveSafeEntryPath(`out-${page}.pdf`, dir)
    );

    if (selectedPaths.length === 1) {
      return await fs.promises.readFile(selectedPaths[0]);
    }

    const unitedPath = resolveSafeEntryPath('united.pdf', dir);
    await runner.unite(selectedPaths, unitedPath);
    return await fs.promises.readFile(unitedPath);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
