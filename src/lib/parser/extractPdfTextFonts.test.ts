import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { vi, type MockInstance } from 'vitest';
import {
  extractPdfText,
  MAX_RETAINED_PDF_FONTS,
  releaseDocumentFonts,
  type PdfJsTransport,
} from './extractPdfText';

type FontFactory = (add: (body: Buffer | string) => number) => number;

function serializePdf(objects: Buffer[]): Buffer {
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  let offset = chunks[0].length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    const head = Buffer.from(`${i + 1} 0 obj\n`);
    const tail = Buffer.from('\nendobj\n');
    offsets.push(offset);
    chunks.push(head, body, tail);
    offset += head.length + body.length + tail.length;
  });
  const xref = offsets
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('');
  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`
    )
  );
  return Buffer.concat(chunks);
}

function flateStream(body: string, dictionary = ''): Buffer {
  const stream = zlib.deflateSync(Buffer.from(body));
  return Buffer.concat([
    Buffer.from(
      `<< ${dictionary} /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`
    ),
    stream,
    Buffer.from('\nendstream'),
  ]);
}

type Drawing = 'on the page' | 'inside a form';

function buildPdf(
  pages: number,
  fontsPerPage: number,
  fontFactory: FontFactory,
  lineFor: (page: number, line: number) => string,
  drawing: Drawing = 'on the page'
): Buffer {
  const objects: Buffer[] = [];
  const add = (body: Buffer | string) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
    return objects.length;
  };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const pageIds: number[] = [];
  for (let p = 0; p < pages; p++) {
    const fontIds = Array.from({ length: fontsPerPage }, () =>
      fontFactory(add)
    );
    const lines = fontIds.map(
      (_, k) => `BT /F${k} 12 Tf 50 ${740 - k * 20} Td (${lineFor(p, k)}) Tj ET`
    );
    const fontResources = `/Font << ${fontIds.map((id, k) => `/F${k} ${id} 0 R`).join(' ')} >>`;
    let resources = fontResources;
    let contentId: number;
    if (drawing === 'inside a form') {
      const formId = add(
        flateStream(
          lines.join('\n'),
          `/Type /XObject /Subtype /Form /BBox [0 0 612 792] /Resources << ${fontResources} >>`
        )
      );
      resources = `/XObject << /Fm0 ${formId} 0 R >>`;
      contentId = add(flateStream('q /Fm0 Do Q'));
    } else {
      contentId = add(flateStream(lines.join('\n')));
    }
    pageIds.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << ${resources} >> /Contents ${contentId} 0 R >>`
      )
    );
  }
  objects[1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`
  );
  return serializePdf(objects);
}

const GLYPHS_PER_FONT = 64;
const FIRST_CHAR = 65;

// A font defined inside the PDF, glyph by glyph, the way OCR tools write the
// fonts they build for each scanned page.
function type3Font(seed: number): FontFactory {
  return (add) => {
    const procs: string[] = [];
    const names: string[] = [];
    for (let g = 0; g < GLYPHS_PER_FONT; g++) {
      const s = (seed * 31 + g * 7) % 400;
      const body = Buffer.from(
        `500 0 0 0 600 700 d1\n${50 + (s % 50)} 0 m ${300 + (s % 90)} 700 l ${550 - (s % 40)} 0 l h f`
      );
      const id = add(
        Buffer.concat([
          Buffer.from(`<< /Length ${body.length} >>\nstream\n`),
          body,
          Buffer.from('\nendstream'),
        ])
      );
      names.push(`/g${g}`);
      procs.push(`/g${g} ${id} 0 R`);
    }
    const widths = Array.from({ length: GLYPHS_PER_FONT }, () => 600).join(' ');
    return add(
      `<< /Type /Font /Subtype /Type3 /FontBBox [0 0 600 700] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << ${procs.join(' ')} >> /Encoding << /Type /Encoding /Differences [${FIRST_CHAR} ${names.join(' ')}] >> /FirstChar ${FIRST_CHAR} /LastChar ${FIRST_CHAR + GLYPHS_PER_FONT - 1} /Widths [${widths}] /Resources << >> >>`
    );
  };
}

function glyphRun(page: number, line: number): string {
  let text = '';
  for (let c = 0; c < 40; c++) {
    text += String.fromCharCode(
      FIRST_CHAR + ((page + line * 3 + c * 5) % GLYPHS_PER_FONT)
    );
  }
  return text.replace(/[\\()]/g, 'A');
}

const helvetica: FontFactory = (add) =>
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

function sharedHelvetica(fontCount: number): FontFactory {
  const ids: number[] = [];
  let calls = 0;
  return (add) => {
    const slot = calls++ % fontCount;
    ids[slot] ??= helvetica(add);
    return ids[slot];
  };
}

// The first half of the pages brings new fonts; the second half draws with
// the first half's fonts again, after they have been released.
function newThenReusedType3(pages: number, fontsPerPage: number): FontFactory {
  const half = Math.floor(pages / 2);
  const firstHalf: number[] = [];
  let calls = 0;
  return (add) => {
    const call = calls++;
    const page = Math.floor(call / fontsPerPage);
    if (page < half) {
      const id = type3Font(call)(add);
      firstHalf.push(id);
      return id;
    }
    return firstHalf[call - half * fontsPerPage];
  };
}

function sentence(page: number, line: number): string {
  return `Page ${page + 1} line ${line + 1} reads plainly`;
}

describe('extractPdfText with a font per page', () => {
  let dir: string;
  let infoSpy: MockInstance;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-text-fonts-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  function extractUnderHeapCap(name: string, pdf: Buffer, heapMb: number) {
    const pdfPath = path.join(dir, name);
    fs.writeFileSync(pdfPath, pdf);
    const script = `
      const fs = require('fs');
      console.info = () => {};
      const { extractPdfText } = require(${JSON.stringify(path.join(__dirname, 'extractPdfText.ts'))});
      extractPdfText(fs.readFileSync(${JSON.stringify(pdfPath)})).then((r) => {
        process.stdout.write('PAGE_COUNT=' + r.pageCount);
      });
    `;

    return spawnSync(
      process.execPath,
      [`--max-old-space-size=${heapMb}`, '--require', 'tsx/cjs', '-e', script],
      { encoding: 'utf8', timeout: 90000 }
    );
  }

  // Measured locally: before the font cache was released this document needed
  // more than 128 MB of old space and died; now it peaks near 65 MB.
  it('reads a PDF that brings its own fonts on every page within a bounded heap', () => {
    let seed = 0;
    const child = extractUnderHeapCap(
      'type3-per-page.pdf',
      buildPdf(150, 6, (add) => type3Font(seed++)(add), glyphRun),
      128
    );

    expect(child.signal).toBeNull();
    expect(child.status).toBe(0);
    expect(child.stdout).toMatch(/PAGE_COUNT=150$/);
  }, 120000);

  // Measured locally: main and a rule that counted only never-seen fonts both
  // died under this cap; releasing idle fonts peaks near 70 MB.
  it('reads a PDF that reuses its released fonts later within a bounded heap', () => {
    const child = extractUnderHeapCap(
      'type3-new-then-reused.pdf',
      buildPdf(300, 6, newThenReusedType3(300, 6), glyphRun),
      128
    );

    expect(child.signal).toBeNull();
    expect(child.status).toBe(0);
    expect(child.stdout).toMatch(/PAGE_COUNT=300$/);
  }, 120000);

  it('keeps every page of text when the font cache is released partway through', async () => {
    const pages = 60;
    const pdf = buildPdf(pages, 3, helvetica, sentence);

    const result = await extractPdfText(pdf);

    expect(pages * 3).toBeGreaterThan(MAX_RETAINED_PDF_FONTS);
    expect(result.pageCount).toBe(pages);
    expect(result.pages.map((page) => page.text)).toEqual(
      Array.from({ length: pages }, (_, p) =>
        [0, 1, 2].map((line) => sentence(p, line)).join('\n')
      )
    );
  }, 30000);

  it.each<Drawing>(['on the page', 'inside a form'])(
    'logs one release for 180 new fonts drawn %s',
    async (drawing) => {
      await extractPdfText(buildPdf(60, 3, helvetica, sentence, drawing));

      expect(infoSpy).toHaveBeenCalledWith(
        '[extractPdfText] result',
        expect.objectContaining({ fontCacheReleases: 1 })
      );
    },
    30000
  );

  it('never releases the font cache for a PDF that reuses a few fonts', async () => {
    await extractPdfText(buildPdf(200, 3, sharedHelvetica(3), sentence));

    expect(infoSpy).toHaveBeenCalledWith(
      '[extractPdfText] result',
      expect.objectContaining({ pageCount: 200, fontCacheReleases: 0 })
    );
  }, 30000);

  it.each<Drawing>(['on the page', 'inside a form'])(
    'never releases the 101 fonts a PDF uses on every page, drawn %s',
    async (drawing) => {
      const fontCount = MAX_RETAINED_PDF_FONTS + 1;

      await extractPdfText(
        buildPdf(30, fontCount, sharedHelvetica(fontCount), sentence, drawing)
      );

      expect(infoSpy).toHaveBeenCalledWith(
        '[extractPdfText] result',
        expect.objectContaining({ pageCount: 30, fontCacheReleases: 0 })
      );
    },
    30000
  );
});

describe('releaseDocumentFonts', () => {
  function transportAnswering(cleanup: () => Promise<unknown>) {
    const commonObjs = { objs: { font: {} }, clear: vi.fn() };
    const transport: PdfJsTransport = {
      messageHandler: { sendWithPromise: vi.fn(cleanup) },
      commonObjs,
      fontLoader: { clear: vi.fn() },
    };
    return { transport, commonObjs };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the fonts the page side holds once pdf.js has cleaned up', async () => {
    const { transport, commonObjs } = transportAnswering(() =>
      Promise.resolve()
    );

    await expect(releaseDocumentFonts(transport)).resolves.toBe(true);
    expect(commonObjs.clear).toHaveBeenCalledTimes(1);
  });

  it('answers false and keeps the fonts when pdf.js rejects the cleanup', async () => {
    const { transport, commonObjs } = transportAnswering(() =>
      Promise.reject(new Error('cleanup failed'))
    );

    await expect(releaseDocumentFonts(transport)).resolves.toBe(false);
    expect(commonObjs.clear).not.toHaveBeenCalled();
  });

  it('answers false when sending the cleanup throws', async () => {
    const { transport } = transportAnswering(() => {
      throw new Error('channel closed');
    });

    await expect(releaseDocumentFonts(transport)).resolves.toBe(false);
  });

  it('stops waiting and answers false when pdf.js never answers', async () => {
    vi.useFakeTimers();
    const { transport, commonObjs } = transportAnswering(
      () => new Promise(() => {})
    );

    const released = releaseDocumentFonts(transport, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(released).resolves.toBe(false);
    expect(commonObjs.clear).not.toHaveBeenCalled();
  });

  it('answers false without a transport, as pdf.js builds without one', async () => {
    await expect(releaseDocumentFonts(undefined)).resolves.toBe(false);
  });
});
