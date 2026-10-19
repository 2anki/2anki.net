import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

function run(binary: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args);
    child.on('error', reject);
    child.on('close', (code) => {
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
    run(resolveBinary(SEPARATE_BINARIES, 'pdfseparate'), [
      '-f',
      String(first),
      '-l',
      String(last),
      inputPath,
      outputPattern,
    ]),
  unite: (inputPaths, outputPath) =>
    run(resolveBinary(UNITE_BINARIES, 'pdfunite'), [...inputPaths, outputPath]),
};

// Extracts `pages` (1-based, sorted ascending, no duplicates) from the PDF into
// a new single PDF carrying only those pages, in that order. poppler's
// pdfseparate writes one file per page named by its absolute page number, so a
// range of 2-4 produces out-2.pdf, out-3.pdf, out-4.pdf; pdfunite then merges
// only the requested files. A single requested page needs no merge — its
// separated file is already a valid one-page PDF.
export async function extractPdfPageRange(
  pdf: Buffer,
  pages: number[],
  runner: PdfPageRangeRunner = popplerRunner
): Promise<Buffer> {
  if (pages.length === 0) {
    throw new Error('extractPdfPageRange requires at least one page');
  }
  const dir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'pdf-page-range-')
  );
  try {
    const inputPath = path.join(dir, 'input.pdf');
    await fs.promises.writeFile(inputPath, pdf);

    const first = pages[0];
    const last = pages[pages.length - 1];
    await runner.separate(inputPath, path.join(dir, 'out-%d.pdf'), first, last);

    const selectedPaths = pages.map((page) =>
      path.join(dir, `out-${page}.pdf`)
    );

    if (selectedPaths.length === 1) {
      return await fs.promises.readFile(selectedPaths[0]);
    }

    const unitedPath = path.join(dir, 'united.pdf');
    await runner.unite(selectedPaths, unitedPath);
    return await fs.promises.readFile(unitedPath);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
