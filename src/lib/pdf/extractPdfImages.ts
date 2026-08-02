import { spawn } from 'child_process';
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

const runPdfImages: PdfImagesRunner = (pdfPath, outputRoot) =>
  new Promise((resolve, reject) => {
    const child = spawn(resolveBinary(), ['-png', '-p', pdfPath, outputRoot]);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pdfimages exited with code ${code}`));
    });
  });

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
