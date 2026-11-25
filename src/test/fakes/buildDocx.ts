import { strToU8, zipSync, type Zippable } from 'fflate';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP_NS =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const MC_NS = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const IMAGE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

export interface DocxImage {
  id: string;
  bytes: Uint8Array;
}

export interface DocxParts {
  body: string;
  images?: DocxImage[];
  footnotes?: Record<string, string>;
  endnotes?: Record<string, string>;
  numberingTarget?: string;
  numberingXml?: string;
  documentRelationships?: string;
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function docxRun(
  text: string,
  props: { bold?: boolean; strike?: boolean } = {}
): string {
  const rPr = `${props.bold ? '<w:b/>' : ''}${props.strike ? '<w:strike/>' : ''}`;
  return `<w:r w:rsidR="00A1B2C3"><w:rPr>${rPr}<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

export function docxParagraph(
  content: string,
  props: {
    style?: string;
    listId?: string;
    level?: number;
    deletedMark?: boolean;
  } = {}
): string {
  const style = props.style ? `<w:pStyle w:val="${props.style}"/>` : '';
  const numbering = props.listId
    ? `<w:numPr><w:ilvl w:val="${props.level ?? 0}"/><w:numId w:val="${props.listId}"/></w:numPr>`
    : '';
  const mark = props.deletedMark
    ? '<w:rPr><w:del w:id="1" w:author="a" w:date="2026-01-01T00:00:00Z"/></w:rPr>'
    : '';
  return `<w:p w:rsidR="00D4E5F6"><w:pPr>${style}${numbering}<w:spacing w:after="160"/>${mark}</w:pPr>${content}</w:p>`;
}

export function docxTable(rows: string[][]): string {
  const body = rows
    .map(
      (cells) =>
        `<w:tr>${cells.map((cell) => `<w:tc>${docxParagraph(docxRun(cell))}</w:tc>`).join('')}</w:tr>`
    )
    .join('');
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${body}</w:tbl>`;
}

export function docxImageRun(imageId: string): string {
  return `<w:r><w:drawing><wp:inline><wp:extent cx="5000000" cy="3000000"/><wp:docPr id="1" name="Picture"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="${imageId}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${imageId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

export function docxFootnoteReference(id: string): string {
  return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
}

export function docxEndnoteReference(id: string): string {
  return `<w:r><w:endnoteReference w:id="${id}"/></w:r>`;
}

export function docxStructuredBlock(content: string): string {
  return `<w:sdt><w:sdtPr><w:alias w:val="Block"/></w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/></w:style><w:style w:type="paragraph" w:styleId="ListBullet2"><w:name w:val="List Bullet 2"/></w:style><w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/></w:style></w:styles>`;

function abstractNum(id: number, formats: string[], styles: string[] = []) {
  const levels = formats
    .map(
      (format, level) =>
        `<w:lvl w:ilvl="${level}">${styles[level] ? `<w:pStyle w:val="${styles[level]}"/>` : ''}<w:numFmt w:val="${format}"/></w:lvl>`
    )
    .join('');
  return `<w:abstractNum w:abstractNumId="${id}">${levels}</w:abstractNum>`;
}

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="${W_NS}">${abstractNum(0, ['bullet', 'bullet', 'bullet'])}${abstractNum(1, ['decimal', 'lowerLetter', 'bullet'])}${abstractNum(2, ['bullet', 'bullet'], ['ListBullet', 'ListBullet2'])}<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num></w:numbering>`;

// A note's content is a paragraph of plain text, or raw paragraph XML when it
// starts with `<w:p`.
function notesXml(kind: 'footnote' | 'endnote', notes: Record<string, string>) {
  const body = Object.entries(notes)
    .map(([id, content]) => {
      const paragraphs = content.startsWith('<w:p')
        ? content
        : docxParagraph(docxRun(content));
      return `<w:${kind} w:id="${id}">${paragraphs}</w:${kind}>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${kind}s xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}"><w:${kind} w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:${kind}>${body}</w:${kind}s>`;
}

function relationships(entries: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries}</Relationships>`;
}

export function buildDocx(parts: DocxParts): Buffer {
  const images = parts.images ?? [];
  const imageRels = images
    .map(
      (image) =>
        `<Relationship Id="rId${image.id}" Type="${IMAGE_REL}" Target="media/${image.id}.png"/>`
    )
    .join('');
  const footnoteRel = parts.footnotes
    ? `<Relationship Id="rIdFootnotes" Type="${R_NS}/footnotes" Target="footnotes.xml"/>`
    : '';
  const endnoteRel = parts.endnotes
    ? `<Relationship Id="rIdEndnotes" Type="${R_NS}/endnotes" Target="endnotes.xml"/>`
    : '';
  const numberingTarget = parts.numberingTarget ?? 'numbering.xml';
  const files: Zippable = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      parts.documentRelationships ??
        relationships(
          `<Relationship Id="rIdStyles" Type="${R_NS}/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="${R_NS}/numbering" Target="${numberingTarget}"/>${footnoteRel}${endnoteRel}${imageRels}`
        )
    ),
    'word/styles.xml': strToU8(STYLES),
    [`word/${numberingTarget}`]: strToU8(parts.numberingXml ?? NUMBERING),
    'word/document.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:mc="${MC_NS}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:body>${parts.body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`
    ),
  };
  for (const kind of ['footnote', 'endnote'] as const) {
    const notes = kind === 'footnote' ? parts.footnotes : parts.endnotes;
    if (notes == null) continue;
    files[`word/${kind}s.xml`] = strToU8(notesXml(kind, notes));
    files[`word/_rels/${kind}s.xml.rels`] = strToU8(relationships(imageRels));
  }
  for (const image of images) {
    files[`word/media/${image.id}.png`] = [image.bytes, { level: 0 }];
  }
  return Buffer.from(zipSync(files, { level: 6 }));
}
