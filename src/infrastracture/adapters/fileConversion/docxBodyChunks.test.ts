import mammoth from 'mammoth';
import { strFromU8, unzipSync } from 'fflate';

import {
  DOCX_BODY_CHUNK_BYTES,
  joinDocxChunkHtml,
  splitDocxBody,
} from './docxBodyChunks';
import {
  buildDocx,
  docxFootnoteReference,
  docxImageRun,
  docxParagraph,
  docxRun,
  docxTable,
} from '../../../test/fakes/buildDocx';

const STYLE_MAP = { styleMap: ['strike => del'] };

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02,
]);

function section(index: number): string {
  const footnote = index % 3 === 0 ? docxFootnoteReference(`${index}`) : '';
  return [
    docxParagraph(docxRun(`Lecture ${index}`), { style: 'Heading1' }),
    docxParagraph(
      docxRun(`Opening line ${index} `, { bold: true }) +
        docxRun('struck', { strike: true }) +
        footnote
    ),
    docxParagraph(docxRun(`Bullet one of ${index}`), { listId: '1' }),
    docxParagraph(docxRun(`Bullet two of ${index}`), { listId: '1' }),
    docxParagraph(''),
    docxParagraph(docxRun(`Bullet three of ${index}`), { listId: '1' }),
    docxParagraph(docxRun(`Styled bullet ${index}`), { style: 'ListBullet' }),
    docxParagraph(docxRun(`Step ${index}.1`), { listId: '2' }),
    docxParagraph(docxRun(`Deleted mark ${index}`), { deletedMark: true }),
    docxParagraph(docxRun(`Absorbs the deleted mark ${index}`)),
    docxParagraph(
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://example.com/' +
        index +
        '" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        docxRun(`link starts ${index}`)
    ),
    docxParagraph(
      docxRun(`link ends ${index}`) +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    ),
    docxTable([
      [`term ${index}`, `definition ${index}`],
      [`term ${index}b`, `definition ${index}b`],
    ]),
    docxParagraph(docxImageRun('img1')),
    docxParagraph(docxRun(`Closing line ${index}`)),
  ].join('');
}

function longDocument(sections: number): Buffer {
  const footnotes: Record<string, string> = {};
  for (let i = 0; i < sections; i += 3) footnotes[`${i}`] = `Note for ${i}`;
  return buildDocx({
    body: Array.from({ length: sections }, (_, i) => section(i)).join(''),
    images: [{ id: 'img1', bytes: PNG_BYTES }],
    footnotes,
  });
}

async function wholeHtml(docx: Buffer): Promise<string> {
  return (await mammoth.convertToHtml({ buffer: docx }, STYLE_MAP)).value;
}

async function chunkedHtml(docx: Buffer, chunkBytes: number) {
  const chunks = splitDocxBody(docx, chunkBytes);
  if (chunks == null) throw new Error('expected the document to split');
  const pieces: string[] = [];
  for (let i = 0; i < chunks.count; i++) {
    pieces.push(await wholeHtml(chunks.docxAt(i)));
  }
  return { count: chunks.count, html: joinDocxChunkHtml(pieces) };
}

function documentXmlOf(docx: Buffer): string {
  return strFromU8(unzipSync(new Uint8Array(docx))['word/document.xml']);
}

describe('splitDocxBody', () => {
  it('leaves a document whose body fits in one piece alone', () => {
    expect(splitDocxBody(longDocument(40), DOCX_BODY_CHUNK_BYTES)).toBeNull();
  });

  it.each([1, 4096])(
    'joins pieces of at least %i bytes into the HTML mammoth writes for the whole document',
    async (chunkBytes) => {
      const docx = longDocument(60);
      const expected = await wholeHtml(docx);

      const { count, html } = await chunkedHtml(docx, chunkBytes);

      expect(count).toBeGreaterThan(10);
      expect(html).toBe(expected);
    }
  );

  it('numbers footnotes in one sequence and lists them once at the end', async () => {
    const { html } = await chunkedHtml(longDocument(30), 4096);

    expect(html.match(/<ol><li id="footnote-/g)).toHaveLength(1);
    expect(html).toContain('id="footnote-ref-27">[10]</a>');
    expect(html.endsWith('</ol>')).toBe(true);
  });

  it('cuts only before a paragraph that starts a fresh element', () => {
    const docx = longDocument(30);
    const chunks = splitDocxBody(docx, 1);
    if (chunks == null) throw new Error('expected the document to split');

    const firstBodyParagraphs = Array.from(
      { length: chunks.count - 1 },
      (_, i) => {
        const xml = documentXmlOf(chunks.docxAt(i + 1));
        return xml.slice(xml.indexOf('<w:body>') + 8).slice(0, 400);
      }
    );

    expect(firstBodyParagraphs.length).toBeGreaterThan(0);
    for (const start of firstBodyParagraphs) {
      expect(start.startsWith('<w:p ')).toBe(true);
      expect(start).not.toMatch(/^<w:p [^>]*><w:pPr>[\s\S]*?<w:numPr>/);
      expect(start).not.toContain('ListBullet');
      expect(start).not.toContain('Absorbs the deleted mark');
      expect(start).not.toContain('link ends');
    }
  });

  it('keeps every byte of the body across the pieces', () => {
    const docx = longDocument(30);
    const chunks = splitDocxBody(docx, 4096);
    if (chunks == null) throw new Error('expected the document to split');

    const bodies = Array.from({ length: chunks.count }, (_, i) => {
      const xml = documentXmlOf(chunks.docxAt(i));
      return xml.slice(
        xml.indexOf('<w:body>') + 8,
        xml.lastIndexOf('</w:body>')
      );
    });
    const original = documentXmlOf(docx);

    expect(bodies.join('')).toBe(
      original.slice(
        original.indexOf('<w:body>') + 8,
        original.lastIndexOf('</w:body>')
      )
    );
  });

  it('declines a file that is not a readable docx', () => {
    expect(splitDocxBody(Buffer.from('not a zip'), 1)).toBeNull();
  });
});
