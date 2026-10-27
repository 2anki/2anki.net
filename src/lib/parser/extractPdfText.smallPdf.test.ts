import { extractPdfText } from './extractPdfText';

function pdfString(text: string): string {
  return `(${text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`;
}

function smallTextPdf(lines: string[]): Buffer {
  const content = [
    'BT',
    '/F1 11 Tf',
    '14 TL',
    '50 750 Td',
    ...lines.flatMap((line, i) =>
      i === 0 ? [`${pdfString(line)} Tj`] : ['T*', `${pdfString(line)} Tj`]
    ),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 3 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('extractPdfText on PDFs under 4 KB', () => {
  it('reads each small upload from its own bytes, never from an earlier one', async () => {
    const uploads = [0, 1, 2, 3].map((n) => ({
      heading: `Owner ${n} private heading`,
      pdf: smallTextPdf([
        `Owner ${n} private heading`,
        `Owner ${n} wrote this confidential sentence number ${n} here.`,
      ]),
    }));
    expect(uploads.every(({ pdf }) => pdf.length < 4096)).toBe(true);

    const texts: string[] = [];
    for (const { pdf } of uploads) {
      const result = await extractPdfText(pdf);
      texts.push(result.pages.map((page) => page.text).join('\n'));
    }

    expect(texts.map((text) => text.split('\n')[0])).toEqual(
      uploads.map(({ heading }) => heading)
    );
  });
});
