import mammoth from 'mammoth';
import { strFromU8, unzipSync } from 'fflate';

import {
  DOCX_BODY_CHUNK_BYTES,
  joinDocxChunkHtml,
  splitDocxBody,
} from './docxBodyChunks';
import { readZipDirectory } from './docxZip';
import {
  buildDocx,
  docxEndnoteReference,
  docxFootnoteReference,
  docxImageRun,
  docxParagraph,
  docxRun,
  docxStructuredBlock,
  docxTable,
  type DocxParts,
} from '../../../test/fakes/buildDocx';

const STYLE_MAP = { styleMap: ['strike => del'] };

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02,
]);

const FIELD_BEGIN =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> HYPERLINK "https://example.com/" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const FIELD_END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';

function deletedRun(text: string): string {
  return `<w:del w:id="7" w:author="a" w:date="2026-01-01T00:00:00Z"><w:r><w:t>${text}</w:t></w:r></w:del>`;
}

function movedFromRun(text: string): string {
  return `<w:moveFrom w:id="8" w:author="a" w:date="2026-01-01T00:00:00Z"><w:r><w:t>${text}</w:t></w:r></w:moveFrom>`;
}

function movedToRun(text: string): string {
  return `<w:moveTo w:id="9" w:author="a" w:date="2026-01-01T00:00:00Z">${docxRun(text)}</w:moveTo>`;
}

function alternateContent(choice: string, fallback: string): string {
  return `<mc:AlternateContent><mc:Choice Requires="wps">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
}

function textBox(paragraph: string): string {
  return `<w:r><w:pict><v:shape><v:textbox><w:txbxContent>${paragraph}</w:txbxContent></v:textbox></v:shape></w:pict></w:r>`;
}

function deletedRow(content: string, keptRow: boolean): string {
  const kept = keptRow
    ? `<w:tr><w:tc>${docxParagraph(docxRun('kept row'))}</w:tc></w:tr>`
    : '';
  return `<w:tbl><w:tr><w:trPr><w:del w:id="3" w:author="a" w:date="2026-01-01T00:00:00Z"/></w:trPr><w:tc>${content}</w:tc></w:tr>${kept}</w:tbl>`;
}

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
    docxParagraph(docxRun(`Nested bullet of ${index}`), {
      listId: '1',
      level: 1,
    }),
    docxParagraph(docxRun(`Styled bullet ${index}`), { style: 'ListBullet' }),
    docxParagraph(docxRun(`Step ${index}.1`), { listId: '2' }),
    docxParagraph(docxRun(`Deleted mark ${index}`), { deletedMark: true }),
    docxParagraph(docxRun(`Absorbs the deleted mark ${index}`)),
    docxParagraph(FIELD_BEGIN + docxRun(`link starts ${index}`)),
    docxParagraph(docxRun(`link ends ${index}`) + FIELD_END),
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
  if (chunks == null) return { count: 1, html: await wholeHtml(docx) };
  const pieces: string[] = [];
  for (let i = 0; i < chunks.count; i++) {
    pieces.push(await wholeHtml(chunks.docxAt(i)));
  }
  return { count: chunks.count, html: joinDocxChunkHtml(pieces) };
}

async function expectPiecesEqualWhole(parts: DocxParts) {
  const docx = buildDocx(parts);
  const { count, html } = await chunkedHtml(docx, 1);
  expect(html).toBe(await wholeHtml(docx));
  return count;
}

function documentXmlOf(docx: Buffer): string {
  return strFromU8(unzipSync(new Uint8Array(docx))['word/document.xml']);
}

function bodyOf(xml: string): string {
  return xml.slice(xml.indexOf('<w:body>') + 8, xml.lastIndexOf('</w:body>'));
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
    },
    60000
  );

  it('numbers footnotes in one sequence and lists them once at the end', async () => {
    const { html } = await chunkedHtml(longDocument(30), 4096);

    expect(html.match(/<ol><li id="footnote-/g)).toHaveLength(1);
    expect(html).toContain('id="footnote-ref-27">[10]</a>');
    expect(html.endsWith('</ol>')).toBe(true);
  });

  it('never starts a piece with a nested list item, a folded paragraph or the end of a field', () => {
    const chunks = splitDocxBody(longDocument(30), 1);
    if (chunks == null) throw new Error('expected the document to split');

    const starts = Array.from({ length: chunks.count - 1 }, (_, i) => {
      const body = bodyOf(documentXmlOf(chunks.docxAt(i + 1)));
      return body.slice(0, body.indexOf('</w:p>'));
    });

    expect(starts.length).toBeGreaterThan(0);
    for (const start of starts) {
      expect(start.startsWith('<w:p ')).toBe(true);
      expect(start).not.toContain('<w:ilvl w:val="1"/>');
      expect(start).not.toContain('Absorbs the deleted mark');
      expect(start).not.toContain('link ends');
      expect(start).not.toMatch(/<\/w:pPr>$/);
    }
  });

  it('keeps every byte of the body across the pieces', () => {
    const docx = longDocument(30);
    const chunks = splitDocxBody(docx, 4096);
    if (chunks == null) throw new Error('expected the document to split');

    const bodies = Array.from({ length: chunks.count }, (_, i) =>
      bodyOf(documentXmlOf(chunks.docxAt(i)))
    );

    expect(bodies.join('')).toBe(bodyOf(documentXmlOf(docx)));
  });

  it('declines a file that is not a readable docx', () => {
    expect(splitDocxBody(Buffer.from('not a zip'), 1)).toBeNull();
  });

  it.each([
    [
      'a table cell',
      (p: string) => docxTable([['cell']]).replace(/<\/w:tc>/, `${p}</w:tc>`),
    ],
    ['a content control', (p: string) => docxStructuredBlock(p)],
  ])(
    'keeps the text of a deleted paragraph mark at the end of %s',
    async (_where, wrap) => {
      const body = [
        docxParagraph(docxRun('before')),
        wrap(
          docxParagraph(docxRun('cell deleted mark'), { deletedMark: true })
        ),
        docxParagraph(docxRun('after table')),
        docxParagraph(docxRun('closing')),
      ].join('');

      await expectPiecesEqualWhole({ body });
    }
  );

  it.each([
    ['deleted text', deletedRun('gone')],
    ['moved-away text', movedFromRun('moved')],
    ['text the newer Word path draws', alternateContent(docxRun('choice'), '')],
    ['a page break', '<w:r><w:br w:type="page"/></w:r>'],
    [
      'a text box',
      textBox(docxParagraph(docxRun('boxed'), { listId: '1', level: 1 })),
    ],
  ])(
    'keeps one list around a paragraph whose only text is %s',
    async (_kind, content) => {
      const body = [
        docxParagraph(docxRun('intro')),
        docxParagraph(docxRun('first'), { listId: '1' }),
        docxParagraph(content),
        docxParagraph(docxRun('second'), { listId: '1', level: 1 }),
        docxParagraph(docxRun('third'), { listId: '1' }),
      ].join('');

      await expectPiecesEqualWhole({ body });
    }
  );

  it.each([
    [
      'deleted text',
      deletedRun('x').replace('<w:r><w:t>x</w:t></w:r>', FIELD_END),
    ],
    ['the newer Word path', alternateContent(FIELD_END, '')],
    ['a deleted table row', ''],
  ])('keeps a link open when its end sits in %s', async (kind, ignoredEnd) => {
    const end =
      kind === 'a deleted table row'
        ? deletedRow(docxParagraph(FIELD_END), false)
        : docxParagraph(ignoredEnd + docxRun('still linked'));
    const body = [
      docxParagraph(docxRun('intro')),
      docxParagraph(FIELD_BEGIN + docxRun('link text')),
      end,
      docxParagraph(docxRun('inside the link')),
      docxParagraph(docxRun('also inside') + FIELD_END),
      docxParagraph(docxRun('after the link')),
    ].join('');

    await expectPiecesEqualWhole({ body });
  });

  it('cuts a long bulleted list between top-level items and keeps it one list', async () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      docxParagraph(docxRun(`point ${i}`), {
        listId: i % 7 === 3 ? '2' : '1',
        level: i % 5 === 4 ? 1 : 0,
      })
    );
    const docx = buildDocx({ body: items.join('') });

    const { count, html } = await chunkedHtml(docx, 1);

    expect(count).toBeGreaterThan(20);
    expect(html).toBe(await wholeHtml(docx));
  });

  it('reads list levels from the numbering part the document names', async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      docxParagraph(docxRun(`point ${i}`), {
        style: i % 2 === 0 ? 'ListBullet' : 'ListBullet2',
      })
    );

    const count = await expectPiecesEqualWhole({
      body: items.join(''),
      numberingTarget: 'numbering2.xml',
    });

    expect(count).toBeGreaterThan(5);
  });

  it.each([
    [
      'single-quoted list levels and ids',
      (level: number) =>
        `<w:numPr><w:ilvl w:val='${level}'/><w:numId w:val='1'/></w:numPr>`,
    ],
    [
      'spaces around the equals sign',
      (level: number) =>
        `<w:numPr><w:ilvl w:val = "${level}"/><w:numId w:val= "1"/></w:numPr>`,
    ],
  ])('keeps nested items nested with %s', async (_kind, numbering) => {
    const items = Array.from(
      { length: 12 },
      (_, i) =>
        `<w:p><w:pPr>${numbering(i % 3 === 0 ? 0 : 1)}</w:pPr>${docxRun(`point ${i}`)}</w:p>`
    );

    const count = await expectPiecesEqualWhole({ body: items.join('') });

    expect(count).toBeGreaterThan(1);
  });

  it.each([
    ['single quotes', "w:fldCharType='begin'", "w:fldCharType='end'", true],
    [
      'an entity',
      'w:fldCharType="&#98;egin"',
      'w:fldCharType="&#x65;nd"',
      false,
    ],
  ])(
    'keeps a link across paragraphs whose field type is written with %s',
    async (_kind, begin, end, splits) => {
      const body = [
        docxParagraph(docxRun('intro')),
        docxParagraph(
          FIELD_BEGIN.replace('w:fldCharType="begin"', begin) +
            docxRun('link text')
        ),
        docxParagraph(docxRun('inside the link')),
        docxParagraph(
          docxRun('still inside') +
            FIELD_END.replace('w:fldCharType="end"', end)
        ),
        docxParagraph(docxRun('after the link')),
      ].join('');

      const count = await expectPiecesEqualWhole({ body });

      expect(count > 1).toBe(splits);
    }
  );

  const notesBody = Array.from({ length: 30 }, (_, i) =>
    docxParagraph(docxRun(`point ${i}`), { listId: '1', level: i % 2 })
  ).join('');

  function timed(run: () => unknown): number {
    const started = performance.now();
    run();
    return performance.now() - started;
  }

  it('reads a numbering part with a long comment inside a level in linear time', async () => {
    const comment = `<!--${'<w:pStyle w:val='.repeat(150_000)}-->`;
    const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">${comment}<w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
    const docx = buildDocx({ body: notesBody, numberingXml });
    expect(docx.length).toBeLessThan(60_000);

    expect(timed(() => splitDocxBody(docx, 1))).toBeLessThan(2000);
    await expectPiecesEqualWhole({ body: notesBody, numberingXml });
  });

  it('gives up on a body nested 100,000 elements deep in linear time', () => {
    const depth = 100_000;
    const body =
      docxParagraph(docxRun('before')) +
      `<w:p>${'<w:smartTag>'.repeat(depth)}${docxRun('deep')}${'</w:smartTag>'.repeat(depth)}</w:p>` +
      docxParagraph(docxRun('after'));
    const docx = buildDocx({ body });
    let chunks: unknown = 'not run';

    const elapsed = timed(() => {
      chunks = splitDocxBody(docx, 1);
    });

    expect(elapsed).toBeLessThan(2000);
    expect(chunks).toBeNull();
  });

  it('gives up on a malformed relationships part in linear time', () => {
    const documentRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${'<Relationship '.repeat(15_000)}`;
    const docx = buildDocx({ body: notesBody, documentRelationships });
    let chunks: unknown = 'not run';

    const elapsed = timed(() => {
      chunks = splitDocxBody(docx, 1);
    });

    expect(elapsed).toBeLessThan(2000);
    expect(chunks).toBeNull();
  });

  it('declines to split a document that is one long paragraph', () => {
    const runs = Array.from({ length: 2000 }, (_, i) => docxRun(`word ${i} `));
    const docx = buildDocx({ body: docxParagraph(runs.join('')) });

    expect(splitDocxBody(docx, 1024)).toBeNull();
  });

  const longBody = Array.from({ length: 30 }, (_, i) =>
    docxParagraph(docxRun(`point ${i}`))
  ).join('');

  it.each([
    [
      'a nested list setting inside alternate content in the paragraph properties',
      `<w:p><w:pPr>${alternateContent(
        '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>',
        '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>'
      )}</w:pPr>${docxRun('nested by fallback')}</w:p>`,
    ],
    [
      'a field start inside alternate content',
      docxParagraph(alternateContent('', FIELD_BEGIN) + docxRun('link?')),
    ],
    [
      'a deleted paragraph mark inside alternate content',
      `<w:p><w:pPr>${alternateContent('', '<w:rPr><w:del w:id="1" w:author="a" w:date="2026-01-01T00:00:00Z"/></w:rPr>')}</w:pPr>${docxRun('folded by fallback')}</w:p>`,
    ],
    [
      'two list settings in one paragraph',
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>${docxRun('which level')}</w:p>`,
    ],
    [
      'a second content block in one content control',
      `<w:sdt><w:sdtContent>${docxParagraph(docxRun('first'))}</w:sdtContent><w:sdtContent>${docxParagraph(docxRun('second'))}</w:sdtContent></w:sdt>`,
    ],
  ])('converts whole a long document with %s', async (_kind, block) => {
    const parts = { body: longBody + block + longBody };
    expect(splitDocxBody(buildDocx(parts), 1)).toBeNull();
    await expectPiecesEqualWhole(parts);
  });

  it.each([
    [
      'a prefixed relationships element',
      '<?xml version="1.0"?><x:Relationships xmlns:x="http://schemas.openxmlformats.org/package/2006/relationships"><x:Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/decoy.xml"/></x:Relationships>',
    ],
    [
      'relationships in no namespace',
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/decoy.xml"/></Relationships>',
    ],
  ])(
    'converts whole a package whose main document is named by %s',
    (_kind, packageRelationships) => {
      const decoy = buildDocx({ body: longBody + longBody });
      const decoyXml = unzipSync(new Uint8Array(decoy))['word/document.xml'];
      const docx = buildDocx({
        body: longBody,
        packageRelationships,
        extraParts: { 'word/decoy.xml': decoyXml },
      });

      expect(splitDocxBody(docx, 1)).toBeNull();
    }
  );

  function withDeclaredSize(docx: Buffer, part: string, size: number): Buffer {
    const patched = Buffer.from(docx);
    const entry = readZipDirectory(patched).entries.get(part);
    if (entry == null) throw new Error(`no ${part}`);
    patched.writeUInt32LE(size, entry.directoryStart + 24);
    patched.writeUInt32LE(size, entry.recordStart + 22);
    return patched;
  }

  it('declines a body declared larger than its cap from the zip directory alone', () => {
    const docx = withDeclaredSize(
      buildDocx({ body: longBody }),
      'word/document.xml',
      480 * 1024 * 1024
    );

    const elapsed = timed(() => expect(splitDocxBody(docx, 1)).toBeNull());

    expect(elapsed).toBeLessThan(200);
  });

  it('declines notes too large to read again in every piece', () => {
    const footnotes: Record<string, string> = {};
    const references: string[] = [];
    for (let i = 1; i <= 20_000; i++) {
      footnotes[`${i}`] = `source ${i}`;
      if (i % 100 === 0) references.push(docxFootnoteReference(`${i}`));
    }
    const docx = buildDocx({
      body: longBody + docxParagraph(docxRun('cited') + references.join('')),
      footnotes,
    });

    const elapsed = timed(() => expect(splitDocxBody(docx, 1)).toBeNull());

    expect(elapsed).toBeLessThan(500);
  });

  it('copies a large unused part into each piece still compressed', () => {
    const docx = buildDocx({
      body: longBody,
      extraParts: { 'customXml/unused.bin': new Uint8Array(100 * 1024 * 1024) },
    });

    const elapsed = timed(() => {
      const chunks = splitDocxBody(docx, 1);
      if (chunks == null) throw new Error('expected the document to split');
      for (let i = 0; i < chunks.count; i++) {
        expect(chunks.docxAt(i).length).toBeLessThan(docx.length + 4096);
      }
    });

    expect(elapsed).toBeLessThan(2000);
  });

  it('declines to split a document that is one long table', () => {
    const rows = Array.from({ length: 400 }, (_, i) => [
      `term ${i}`,
      `meaning ${i}`,
    ]);
    const docx = buildDocx({
      body: docxParagraph(docxRun('Glossary')) + docxTable(rows),
    });

    expect(splitDocxBody(docx, 1024)).toBeNull();
  });
});

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function requote(xml: string, variant: 'double' | 'single' | 'spaced'): string {
  if (variant === 'double') return xml;
  return xml.replace(/(\s[\w:]+)="([^"]*)"/g, (_match, name, value) =>
    variant === 'single' ? `${name}='${value}'` : `${name} = "${value}"`
  );
}

// Each of these makes the whole file convert as it did before splitting.
const DECLINING_BLOCKS: ((text: string) => string)[] = [
  (text) => docxParagraph(alternateContent(docxRun(text), docxRun(text))),
  (text) =>
    `<w:p><w:pPr>${alternateContent(
      '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>',
      '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>'
    )}</w:pPr>${docxRun(text)}</w:p>`,
  (text) =>
    docxParagraph(
      `<x:note xmlns:x="urn:example:notes">${docxRun(text)}</x:note>`
    ),
  (text) => docxParagraph(`${docxRun(text)}<note xmlns="urn:example:notes"/>`),
  (text) =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>${docxRun(text)}</w:p>`,
  (text) =>
    `<w:sdt><w:sdtContent>${docxParagraph(docxRun(text))}</w:sdtContent><w:sdtContent>${docxParagraph(docxRun(text))}</w:sdtContent></w:sdt>`,
  (text) => docxParagraph(`<w:dir w:val="rtl">${docxRun(text)}</w:dir>`),
];

function randomDocument(random: () => number, declining: boolean): DocxParts {
  const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
  const footnotes: Record<string, string> = {};
  const endnotes: Record<string, string> = {};
  let noteId = 1;
  let openFields = 0;
  let word = 0;
  const text = () => `w${word++}`;
  const richRun = () =>
    pick([
      () => docxRun(text()),
      () => docxRun(text(), { bold: true }),
      () => docxRun(text(), { strike: true }),
      () => `<w:hyperlink w:anchor="mark1">${docxRun(text())}</w:hyperlink>`,
      () => `${docxRun(text())}<w:r><w:tab/></w:r>`,
      () => `${docxRun(text())}<w:r><w:br/></w:r>`,
      () => movedToRun(text()),
      () => `${docxRun(text())}${deletedRun(text())}`,
      () => docxRun(' '),
      () => docxImageRun('img1'),
      () => {
        const id = `${noteId++}`;
        footnotes[id] = pick([
          () => `note ${id}`,
          () => docxParagraph(docxRun(`note ${id}`) + docxImageRun('img1')),
          () => {
            const nested = `${noteId++}`;
            footnotes[nested] = `nested note ${nested}`;
            return docxParagraph(
              docxRun(`note ${id}`) + docxFootnoteReference(nested)
            );
          },
        ])();
        return docxRun(text()) + docxFootnoteReference(id);
      },
      () => {
        const id = `${noteId++}`;
        endnotes[id] = `endnote ${id}`;
        return docxRun(text()) + docxEndnoteReference(id);
      },
    ])();
  const listItem = () =>
    docxParagraph(richRun(), {
      listId: pick(['1', '1', '2']),
      level: pick([0, 0, 0, 1, 1, 2]),
    });
  const paragraphs: (() => string)[] = [
    () => docxParagraph(richRun() + richRun()),
    () => docxParagraph(richRun(), { style: pick(['Heading1', 'Heading2']) }),
    listItem,
    listItem,
    listItem,
    () =>
      docxParagraph(richRun(), { style: pick(['ListBullet', 'ListBullet2']) }),
    () => docxParagraph(''),
    () => docxParagraph(pick([deletedRun(text()), movedFromRun(text())])),
    () => docxParagraph('<w:r><w:br w:type="page"/></w:r>'),
    () => docxParagraph(`<w:proofErr w:type="spellStart"/>${richRun()}`),
    () => docxParagraph(richRun(), { deletedMark: true }),
    () =>
      docxParagraph(richRun(), {
        listId: '1',
        level: pick([0, 1]),
        deletedMark: true,
      }),
    () =>
      docxParagraph(
        textBox(pick([listItem, () => docxParagraph(richRun())])())
      ),
    () => {
      openFields += 1;
      return docxParagraph(FIELD_BEGIN + richRun());
    },
    () => {
      if (openFields === 0) return docxParagraph(richRun());
      openFields -= 1;
      return docxParagraph(richRun() + FIELD_END);
    },
  ];
  const cellParagraph = () =>
    pick([
      () => docxParagraph(richRun()),
      listItem,
      () => docxParagraph(richRun(), { deletedMark: true }),
      () => docxParagraph(deletedRun(text())),
    ])();
  const blocks: (() => string)[] = [
    ...paragraphs,
    ...paragraphs,
    () =>
      `<w:tbl><w:tr><w:tc>${cellParagraph()}</w:tc><w:tc>${cellParagraph()}${cellParagraph()}</w:tc></w:tr></w:tbl>`,
    () =>
      deletedRow(
        pick([
          () => docxParagraph(docxRun(text())),
          () => docxParagraph(FIELD_BEGIN + docxRun(text())),
          () => docxParagraph(docxRun(text()) + FIELD_END),
        ])(),
        random() < 0.5
      ),
    () => docxStructuredBlock(cellParagraph() + cellParagraph()),
    () => '<w:bookmarkStart w:id="1" w:name="mark1"/><w:bookmarkEnd w:id="1"/>',
  ];
  const length = 8 + Math.floor(random() * 25);
  const pieces = Array.from({ length }, () =>
    requote(pick(blocks)(), pick(['double', 'double', 'single', 'spaced']))
  );
  if (declining) {
    const at = Math.floor(random() * pieces.length);
    pieces.splice(at, 0, pick(DECLINING_BLOCKS)(text()));
  }
  const body = pieces.join('');
  return {
    body,
    images: [{ id: 'img1', bytes: PNG_BYTES }],
    footnotes: Object.keys(footnotes).length > 0 ? footnotes : undefined,
    endnotes: Object.keys(endnotes).length > 0 ? endnotes : undefined,
  };
}

describe('splitDocxBody on random documents', () => {
  it('converts 500 random documents cut at every allowed place to the HTML of converting them whole', async () => {
    const random = mulberry32(20261125);
    let split = 0;
    const distinct = new Set<string>();
    for (let index = 0; index < 500; index++) {
      const parts = randomDocument(random, false);
      distinct.add(parts.body);
      const docx = buildDocx(parts);
      const whole = await wholeHtml(docx);
      const { count, html } = await chunkedHtml(docx, 1);
      if (count > 1) split += 1;
      expect({ index, html }).toEqual({ index, html: whole });
    }
    expect(split).toBeGreaterThan(400);
    expect(distinct.size).toBe(500);
  }, 180000);

  it('declines 300 random documents that carry one thing it does not recognise', () => {
    const random = mulberry32(20261126);
    const distinct = new Set<string>();
    for (let index = 0; index < 300; index++) {
      const parts = randomDocument(random, true);
      distinct.add(parts.body);
      expect({ index, chunks: splitDocxBody(buildDocx(parts), 1) }).toEqual({
        index,
        chunks: null,
      });
    }
    expect(distinct.size).toBe(300);
  }, 120000);
});
