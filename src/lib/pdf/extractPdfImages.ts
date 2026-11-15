import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ExtractedPdfImage {
  pageIndex: number;
  name: string;
  contents: Buffer;
}

// pdfimages also emits page furniture — bullet glyphs, rules, watermark
// tiles. Anything this small is furniture, not a figure worth carding.
export const MIN_PDF_IMAGE_BYTES = 4096;
// A slide deck can carry hundreds of embedded images; cap what one PDF may
// add to a deck so a pathological document cannot flood the media folder.
export const MAX_PDF_IMAGES = 64;

const CANDIDATE_BINARIES =
  os.platform() === 'darwin'
    ? ['/opt/homebrew/bin/pdfimages', '/usr/local/bin/pdfimages']
    : ['/usr/bin/pdfimages'];

function resolveBinary(): string {
  return CANDIDATE_BINARIES.find((p) => fs.existsSync(p)) ?? 'pdfimages';
}

export type PdfImagesRunner = (
  pdfPath: string,
  outputRoot: string
) => Promise<void>;

// Nothing else bounds this tool: the conversion pool has no per-job deadline.
// Extraction time is not measured, so the limit is set wide: it exists to
// free a worker from a run that will never end, not to cut a slow large PDF
// short. Past it the deck is built without embedded images.
const PDF_IMAGES_TIMEOUT_MS = 5 * 60_000;

// The tool's output is discarded, never piped. A damaged PDF makes pdfimages
// print a warning per broken object; with a pipe nobody reads, it blocked on
// the full pipe for good and held its conversion worker with it.
//
// A timeout rejects only once the killed tool has closed, so the caller never
// removes the output folder while the tool can still write into it.
export function runImageTool(
  binary: string,
  args: string[],
  timeoutMs: number = PDF_IMAGES_TIMEOUT_MS
): Promise<void> {
  return new Promise((resolve, reject) => {
    const name = path.basename(binary);
    const child = spawn(binary, args, { shell: false, stdio: 'ignore' });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`${name} timed out`));
      else if (code === 0) resolve();
      else reject(new Error(`${name} exited with code ${code}`));
    });
  });
}

const runPdfImages: PdfImagesRunner = (pdfPath, outputRoot) =>
  runImageTool(resolveBinary(), ['-png', '-p', pdfPath, outputRoot]);

// `pdfimages -p` names files `<root>-<page>-<imageNumber>.png` with 1-based
// page numbers; pageIndex converts to the 0-based index PdfPage arrays use.
const OUTPUT_NAME = /-(\d+)-(\d+)\.png$/;

export async function extractPdfImages(
  pdf: Buffer,
  runner: PdfImagesRunner = runPdfImages
): Promise<ExtractedPdfImage[]> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-images-'));
  try {
    const pdfPath = path.join(dir, 'input.pdf');
    await fs.promises.writeFile(pdfPath, pdf);
    await runner(pdfPath, path.join(dir, 'img'));

    const entries = (await fs.promises.readdir(dir)).sort((a, b) =>
      a.localeCompare(b)
    );
    const images: ExtractedPdfImage[] = [];
    for (const entry of entries) {
      const match = OUTPUT_NAME.exec(entry);
      if (!match) continue;
      const filePath = path.join(dir, entry);
      const stat = await fs.promises.stat(filePath);
      if (stat.size < MIN_PDF_IMAGE_BYTES) continue;
      images.push({
        pageIndex: Number(match[1]) - 1,
        name: entry,
        contents: await fs.promises.readFile(filePath),
      });
      if (images.length >= MAX_PDF_IMAGES) break;
    }
    return images;
  } catch (error) {
    // A missing binary or a malformed PDF degrades to the previous behavior
    // (no embedded images); the conversion itself must never fail over this.
    console.warn('[pdf] embedded image extraction skipped', {
      error: String(error),
    });
    return [];
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
