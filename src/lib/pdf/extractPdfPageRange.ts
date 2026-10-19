import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveSafeEntryPath } from '../vocab/safeEntryPath';
import { PAYING_MAX_UPLOAD_SIZE } from '../misc/getUploadLimits';
import { PdfPageRangeError } from './pdfPageRange';

// The buffer is already bounded by the multer upload cap; this is a
// defence-in-depth ceiling so a caller that bypasses the upload path can never
// hand page-range extraction an unbounded PDF. Equal to the largest upload any
// plan allows, so it never rejects a real upload.
const MAX_PDF_BYTES = PAYING_MAX_UPLOAD_SIZE;

// poppler is deterministic and fast on a bounded PDF; a run that has not
// finished in this window is pathological (a decompression bomb, a hung child)
// and is killed rather than left to pin a worker.
export const PDF_PAGE_RANGE_TIMEOUT_MS = 60_000;

// pdfunite opens every input at once, so a sparse selection of thousands of
// pages would blow past the open-file-descriptor limit. Merge in batches and
// then merge the batch outputs.
const MAX_UNITE_INPUTS = 500;

const STDERR_KEEP_BYTES = 200;

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

// argv array with shell:false (CWE-78), a hard timeout mapped to a plain-message
// PdfPageRangeError, and the first bytes of stderr kept for a non-zero exit.
// Every argument is an internal temp path or an integer page number, never a
// shell string.
export function runPdfTool(
  binary: string,
  args: string[],
  timeoutMs: number = PDF_PAGE_RANGE_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < STDERR_KEEP_BYTES) {
        stderr += chunk.toString();
      }
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new PdfPageRangeError(
          'That PDF took too long to split into the pages you asked for. Try fewer pages.'
        )
      );
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        const tail = stderr.slice(0, STDERR_KEEP_BYTES).trim() || '<empty>';
        reject(
          new Error(
            `${path.basename(binary)} exited with code ${code}: ${tail}`
          )
        );
      }
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

function contiguousRuns(
  pages: number[]
): Array<{ first: number; last: number }> {
  const runs: Array<{ first: number; last: number }> = [];
  for (const page of pages) {
    const open = runs[runs.length - 1];
    if (open && page === open.last + 1) {
      open.last = page;
    } else {
      runs.push({ first: page, last: page });
    }
  }
  return runs;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Merge the selected per-page files into one, in batches so pdfunite never
// opens more than MAX_UNITE_INPUTS descriptors at once; the batch outputs are
// then merged the same way until one file remains.
async function uniteInBatches(
  runner: PdfPageRangeRunner,
  paths: string[],
  dir: string
): Promise<string> {
  let current = paths;
  let round = 0;
  while (current.length > 1) {
    const groups = chunk(current, MAX_UNITE_INPUTS);
    const outputs: string[] = [];
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].length === 1) {
        outputs.push(groups[i][0]);
        continue;
      }
      const output = resolveSafeEntryPath(`united-${round}-${i}.pdf`, dir);
      await runner.unite(groups[i], output);
      outputs.push(output);
    }
    current = outputs;
    round += 1;
  }
  return current[0];
}

// Extracts `pages` (1-based, sorted ascending, no duplicates) into a new PDF
// carrying only those pages, in order. pdfseparate is run once per contiguous
// run of pages (so a sparse selection like 1, 5000 writes two files, not 5000),
// writing one file per page named by its absolute page number; pdfunite then
// merges only the requested files, in batches. Every temp file lives inside the
// upload workspace (resolved through the zip-slip guard) and is removed in a
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

    const outputPattern = resolveSafeEntryPath('out-%d.pdf', dir);
    for (const run of contiguousRuns(pages)) {
      await runner.separate(inputPath, outputPattern, run.first, run.last);
    }

    const selectedPaths = pages.map((page) =>
      resolveSafeEntryPath(`out-${page}.pdf`, dir)
    );
    const merged = await uniteInBatches(runner, selectedPaths, dir);
    return await fs.promises.readFile(merged);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
