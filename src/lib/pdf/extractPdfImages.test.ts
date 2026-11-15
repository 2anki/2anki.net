import fs from 'node:fs';
import path from 'node:path';
import {
  extractPdfImages,
  MIN_PDF_IMAGE_BYTES,
  MAX_PDF_IMAGES,
  PdfImagesRunner,
  runImageTool,
} from './extractPdfImages';

function fakeRunner(files: Record<string, number | Buffer>): PdfImagesRunner {
  return async (_pdfPath, outputRoot) => {
    for (const [suffix, sizeOrBytes] of Object.entries(files)) {
      const contents = Buffer.isBuffer(sizeOrBytes)
        ? sizeOrBytes
        : Buffer.alloc(sizeOrBytes, 1);
      await fs.promises.writeFile(`${outputRoot}${suffix}`, contents);
    }
  };
}

describe('extractPdfImages', () => {
  it('collects figures with their 0-based page index', async () => {
    const images = await extractPdfImages(
      Buffer.from('%PDF-fake'),
      fakeRunner({
        '-001-000.png': MIN_PDF_IMAGE_BYTES,
        '-003-001.png': MIN_PDF_IMAGE_BYTES + 10,
      })
    );

    expect(images.map((i) => i.pageIndex)).toEqual([0, 2]);
    expect(images[0].name).toMatch(/-001-000\.png$/);
    expect(images[1].contents).toHaveLength(MIN_PDF_IMAGE_BYTES + 10);
  });

  it('drops page furniture below the size floor', async () => {
    const images = await extractPdfImages(
      Buffer.from('%PDF-fake'),
      fakeRunner({
        '-001-000.png': 100,
        '-001-001.png': MIN_PDF_IMAGE_BYTES,
      })
    );

    expect(images).toHaveLength(1);
    expect(images[0].name).toMatch(/-001-001\.png$/);
  });

  it('caps the number of images taken from one PDF', async () => {
    const files: Record<string, number> = {};
    for (let i = 0; i < MAX_PDF_IMAGES + 5; i++) {
      files[`-001-${String(i).padStart(3, '0')}.png`] = MIN_PDF_IMAGE_BYTES;
    }

    const images = await extractPdfImages(
      Buffer.from('%PDF-fake'),
      fakeRunner(files)
    );

    expect(images).toHaveLength(MAX_PDF_IMAGES);
  });

  it('returns an empty list when the extractor fails', async () => {
    const images = await extractPdfImages(Buffer.from('%PDF-fake'), () =>
      Promise.reject(new Error('spawn pdfimages ENOENT'))
    );

    expect(images).toEqual([]);
  });

  it('ignores files that do not match the pdfimages naming scheme', async () => {
    const images = await extractPdfImages(
      Buffer.from('%PDF-fake'),
      fakeRunner({ '-junk.txt': MIN_PDF_IMAGE_BYTES })
    );

    expect(images).toEqual([]);
  });

  it('cleans up its temp directory', async () => {
    const before = fs
      .readdirSync(path.join(require('node:os').tmpdir()))
      .filter((d) => d.startsWith('pdf-images-')).length;

    await extractPdfImages(
      Buffer.from('%PDF-fake'),
      fakeRunner({ '-001-000.png': MIN_PDF_IMAGE_BYTES })
    );

    const after = fs
      .readdirSync(path.join(require('node:os').tmpdir()))
      .filter((d) => d.startsWith('pdf-images-')).length;
    expect(after).toBeLessThanOrEqual(before);
  });
});

describe('runImageTool', () => {
  const NOISY_THEN_EXIT =
    "process.stderr.write('x'.repeat(4 * 1024 * 1024), () => process.exit(0))";

  it('finishes when the tool prints more than a pipe holds', async () => {
    await expect(
      runImageTool(process.execPath, ['-e', NOISY_THEN_EXIT], 20_000)
    ).resolves.toBeUndefined();
  });

  // The rejection comes from the killed tool closing: left alive, sleep
  // would exit cleanly and this would resolve instead.
  it('kills a tool that overruns the timeout', async () => {
    await expect(runImageTool('/bin/sleep', ['5'], 50)).rejects.toThrow(
      'sleep timed out'
    );
  });

  it('rejects when the tool exits with a failure code', async () => {
    await expect(
      runImageTool(process.execPath, ['-e', 'process.exit(3)'], 20_000)
    ).rejects.toThrow('exited with code 3');
  });
});
