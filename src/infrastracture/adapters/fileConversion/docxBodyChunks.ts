import { unzipSync, zipSync, type Zippable } from 'fflate';

// mammoth holds the parsed XML, its own element tree, the document model and
// two copies of the HTML tree at once: about 40 bytes of heap per byte of
// word/document.xml. A long Word document (tens of MB of XML) therefore runs
// a 1 GB conversion child out of heap. Splitting the body at paragraph
// boundaries and converting each piece in turn bounds that working set to one
// piece; the joined HTML is the HTML mammoth writes for the whole document.
export const DOCX_BODY_CHUNK_BYTES = 2 * 1024 * 1024;

const OFFICE_DOCUMENT_REL =
  /Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/officeDocument"/;
const EMBEDDED_STYLE_MAP_PART = 'mammoth/style-map';
const BODY_OPEN = /<w:body(?:\s[^>]*)?>/;
const BODY_CLOSE = '</w:body>';

export interface DocxBodyChunks {
  count: number;
  docxAt(index: number): Buffer;
}

interface TopLevelElement {
  start: number;
  end: number;
}

function partNameFromTarget(target: string): string {
  return target.replace(/^\//, '');
}

function mainDocumentPart(rootRels: string): string | null {
  for (const match of rootRels.matchAll(/<Relationship\s[^>]*>/g)) {
    const tag = match[0];
    if (!OFFICE_DOCUMENT_REL.test(tag)) continue;
    const target = /Target="([^"]+)"/.exec(tag);
    return target ? partNameFromTarget(target[1]) : null;
  }
  return null;
}

function declaredPartSizes(contents: Buffer): Map<string, number> {
  const sizes = new Map<string, number>();
  unzipSync(new Uint8Array(contents), {
    filter: (file) => {
      sizes.set(file.name, file.originalSize);
      return false;
    },
  });
  return sizes;
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString(
    'latin1'
  );
}

function tagEnd(xml: string, from: number): number {
  let quote = 0;
  for (let i = from + 1; i < xml.length; i++) {
    const code = xml.charCodeAt(i);
    if (quote !== 0) {
      if (code === quote) quote = 0;
    } else if (code === 0x22 || code === 0x27) {
      quote = code;
    } else if (code === 0x3e) {
      return i;
    }
  }
  return -1;
}

function skipMarkup(xml: string, at: number): number | null {
  if (xml.startsWith('<!--', at)) return xml.indexOf('-->', at) + 3;
  if (xml.startsWith('<![CDATA[', at)) return xml.indexOf(']]>', at) + 3;
  if (xml.startsWith('<?', at)) return xml.indexOf('?>', at) + 2;
  return null;
}

function topLevelElements(
  xml: string,
  from: number,
  to: number
): TopLevelElement[] | null {
  const elements: TopLevelElement[] = [];
  let depth = 0;
  let elementStart = -1;
  let cursor = from;
  while (cursor < to) {
    const open = xml.indexOf('<', cursor);
    if (open === -1 || open >= to) break;
    const skipped = skipMarkup(xml, open);
    if (skipped != null) {
      if (skipped < open) return null;
      cursor = skipped;
      continue;
    }
    const close = tagEnd(xml, open);
    if (close === -1 || close >= to) return null;
    if (xml.charCodeAt(open + 1) === 0x2f) {
      depth -= 1;
      if (depth < 0) return null;
      if (depth === 0) elements.push({ start: elementStart, end: close + 1 });
    } else if (xml.charCodeAt(close - 1) === 0x2f) {
      if (depth === 0) elements.push({ start: open, end: close + 1 });
    } else {
      if (depth === 0) elementStart = open;
      depth += 1;
    }
    cursor = close + 1;
  }
  return depth === 0 ? elements : null;
}

function isParagraph(element: string): boolean {
  return /^<w:p[\s>]/.test(element);
}

function paragraphProperties(element: string): string {
  const openEnd = element.indexOf('>');
  const rest = element.slice(openEnd + 1).trimStart();
  if (!/^<w:pPr[\s>]/.test(rest)) return '';
  const end = rest.indexOf('</w:pPr>');
  return end === -1 ? '' : rest.slice(0, end);
}

function paragraphStyle(pPr: string): string | null {
  const match = /<w:pStyle\s[^>]*w:val="([^"]*)"/.exec(pPr);
  return match ? match[1] : null;
}

function hasVisibleText(element: string): boolean {
  return /<w:t(?:\s[^>]*)?>[^<]/.test(element);
}

function fieldDepthChange(element: string): number {
  const begins = element.match(/w:fldCharType="begin"/g)?.length ?? 0;
  const ends = element.match(/w:fldCharType="end"/g)?.length ?? 0;
  return begins - ends;
}

function numberedParagraphStyles(numberingXml: string): Set<string> {
  const styles = new Set<string>();
  for (const match of numberingXml.matchAll(
    /<w:pStyle\s[^>]*w:val="([^"]*)"/g
  )) {
    styles.add(match[1]);
  }
  return styles;
}

// A cut is safe only before a paragraph mammoth renders as a fresh top-level
// element: not a list item (those merge with the list before them), not empty
// (an ignored paragraph would let the next list item merge across the cut),
// not inside an open complex field, and not after a paragraph whose mark was
// deleted (mammoth folds that paragraph into the next one).
function cutOffsets(
  xml: string,
  elements: TopLevelElement[],
  listStyles: Set<string>,
  bodyStart: number,
  chunkBytes: number
): number[] {
  const cuts: number[] = [];
  let chunkStart = bodyStart;
  let fieldDepth = 0;
  let deletedMarkPending = false;
  for (const { start, end } of elements) {
    const element = xml.slice(start, end);
    const paragraph = isParagraph(element);
    const pPr = paragraph ? paragraphProperties(element) : '';
    const style = paragraphStyle(pPr);
    const isListItem =
      /<w:numPr[\s>/]/.test(pPr) || (style != null && listStyles.has(style));
    const safe =
      paragraph &&
      !isListItem &&
      fieldDepth === 0 &&
      !deletedMarkPending &&
      hasVisibleText(element);
    if (safe && start - chunkStart >= chunkBytes) {
      cuts.push(start);
      chunkStart = start;
    }
    fieldDepth += fieldDepthChange(element);
    if (paragraph) deletedMarkPending = /<w:del[\s>/]/.test(pPr);
  }
  return cuts;
}

export function splitDocxBody(
  contents: Buffer,
  chunkBytes: number
): DocxBodyChunks | null {
  try {
    const sizes = declaredPartSizes(contents);
    if (sizes.has(EMBEDDED_STYLE_MAP_PART)) return null;
    const parts = unzipSync(new Uint8Array(contents), {
      filter: (file) => file.name === '_rels/.rels',
    });
    const rootRels = parts['_rels/.rels'];
    if (rootRels == null) return null;
    const documentPart = mainDocumentPart(latin1(rootRels));
    if (documentPart == null) return null;
    if ((sizes.get(documentPart) ?? 0) <= chunkBytes) return null;

    const entries = unzipSync(new Uint8Array(contents));
    const documentBytes = entries[documentPart];
    if (documentBytes == null) return null;
    const xml = latin1(documentBytes);
    const bodyOpen = BODY_OPEN.exec(xml);
    const bodyEnd = xml.lastIndexOf(BODY_CLOSE);
    if (bodyOpen == null || bodyEnd === -1) return null;
    const bodyStart = bodyOpen.index + bodyOpen[0].length;
    const elements = topLevelElements(xml, bodyStart, bodyEnd);
    if (elements == null) return null;

    const numberingPart = documentPart.replace(/[^/]*$/, 'numbering.xml');
    const numbering = entries[numberingPart];
    const listStyles = numberedParagraphStyles(
      numbering ? latin1(numbering) : ''
    );
    const cuts = cutOffsets(xml, elements, listStyles, bodyStart, chunkBytes);
    if (cuts.length === 0) return null;

    const bounds = [bodyStart, ...cuts, bodyEnd];
    const head = xml.slice(0, bodyStart);
    const tail = xml.slice(bodyEnd);
    const otherEntries: Zippable = {};
    for (const [name, bytes] of Object.entries(entries)) {
      if (name !== documentPart) otherEntries[name] = [bytes, { level: 0 }];
    }
    return {
      count: bounds.length - 1,
      docxAt(index: number): Buffer {
        const body = xml.slice(bounds[index], bounds[index + 1]);
        const documentXml = Buffer.from(head + body + tail, 'latin1');
        return Buffer.from(
          zipSync({
            ...otherEntries,
            [documentPart]: [new Uint8Array(documentXml), { level: 0 }],
          })
        );
      },
    };
  } catch {
    return null;
  }
}

const NOTES_LIST = /<ol><li id="(?:footnote|endnote)-/g;
const NOTE_REFERENCE_LABEL =
  /(<a href="#(?:footnote|endnote)-[^"]*" id="(?:footnote|endnote)-ref-[^"]*">\[)(\d+)(\]<\/a>)/g;

function trailingNotesStart(html: string): number {
  let start = -1;
  for (const match of html.matchAll(NOTES_LIST)) start = match.index;
  return start !== -1 && html.endsWith('</ol>') ? start : -1;
}

// Each piece numbers its note references from 1 and lists its own notes after
// its body; the whole document numbers them in one sequence and lists every
// note once, at the end.
export function joinDocxChunkHtml(chunks: string[]): string {
  const bodies: string[] = [];
  const notes: string[] = [];
  let notesBefore = 0;
  for (const html of chunks) {
    const notesStart = trailingNotesStart(html);
    const body = notesStart === -1 ? html : html.slice(0, notesStart);
    let references = 0;
    bodies.push(
      body.replace(
        NOTE_REFERENCE_LABEL,
        (_match: string, open: string, label: string, close: string) => {
          references += 1;
          return `${open}${Number(label) + notesBefore}${close}`;
        }
      )
    );
    notesBefore += references;
    if (notesStart !== -1) {
      notes.push(html.slice(notesStart + '<ol>'.length, -'</ol>'.length));
    }
  }
  const notesList = notes.length > 0 ? `<ol>${notes.join('')}</ol>` : '';
  return bodies.join('') + notesList;
}
