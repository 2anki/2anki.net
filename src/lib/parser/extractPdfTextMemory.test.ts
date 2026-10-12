import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

// A drawing-heavy PDF: every page carries a short text run plus thousands of
// stroked line segments, so each page's operator list is large while the
// text stays tiny. Built at test time so no multi-megabyte fixture lands in git.
function buildVectorHeavyPdf(pages: number, segmentsPerPage: number): Buffer {
  const objects: Buffer[] = [];
  const add = (body: Buffer) => objects.push(body);
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  add(Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`));
  add(Buffer.alloc(0));
  add(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));

  const pageIds: number[] = [];
  for (let p = 0; p < pages; p++) {
    const lines = [
      `BT /F1 18 Tf 50 750 Td (Heading ${p + 1}) Tj 0 -24 Td (Body text for page ${p + 1} with enough characters to read as text.) Tj ET`,
    ];
    for (let i = 0; i < segmentsPerPage; i++) {
      const x = (i * 7919 + p) % 600;
      const y = (i * 104729) % 780;
      lines.push(`${x} ${y} m ${x + 3} ${y + 2} l S`);
    }
    const stream = zlib.deflateSync(Buffer.from(lines.join('\n')));
    add(
      Buffer.concat([
        Buffer.from(
          `<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`
        ),
        stream,
        Buffer.from('\nendstream'),
      ])
    );
    const contentId = objects.length;
    add(
      Buffer.from(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
      )
    );
    pageIds.push(objects.length);
  }
  objects[pagesId - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`
  );

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
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${offset}\n%%EOF\n`
    )
  );
  return Buffer.concat(chunks);
}

describe('extractPdfText memory', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-text-memory-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Measured locally: without releasing each page this document needs more
  // than 192 MB of old space; releasing pages keeps it well under 96 MB.
  it('reads a drawing-heavy PDF without holding every page in the heap', () => {
    const pdfPath = path.join(dir, 'drawings.pdf');
    fs.writeFileSync(pdfPath, buildVectorHeavyPdf(30, 20000));
    const script = `
      const fs = require('fs');
      const { extractPdfText } = require(${JSON.stringify(path.join(__dirname, 'extractPdfText.ts'))});
      extractPdfText(fs.readFileSync(${JSON.stringify(pdfPath)})).then((r) => {
        process.stdout.write('PAGE_COUNT=' + r.pageCount);
      });
    `;

    const child = spawnSync(
      process.execPath,
      ['--max-old-space-size=128', '--require', 'tsx/cjs', '-e', script],
      { encoding: 'utf8', timeout: 60000 }
    );

    expect(child.signal).toBeNull();
    expect(child.status).toBe(0);
    expect(child.stdout).toMatch(/PAGE_COUNT=30$/);
  }, 90000);
});
