import { unzipSync, zipSync, type Zippable } from 'fflate';

// mammoth holds the parsed XML, its own element tree, the document model and
// two copies of the HTML tree at once: about 40 bytes of heap per byte of
// word/document.xml. A long Word document (tens of MB of XML) therefore runs
// a 1 GB conversion child out of heap. Splitting the body between top-level
// paragraphs and converting each piece in turn bounds that working set to one
// piece; the joined HTML is the HTML mammoth writes for the whole document.
//
// The split is only right where this file's reading of the XML matches what
// mammoth does with state that crosses top-level siblings:
// - an open complex field (HYPERLINK, FORMCHECKBOX) wraps every later run, so
//   no cut while one is open, counting only the field characters mammoth reads;
// - a deleted paragraph mark folds that paragraph into the next one read,
//   inside tables and content controls too, so no cut while one is pending;
// - adjacent lists merge into one, and a nested item merges into the item
//   before it, so a piece may start with a top-level list item (the join
//   merges `</ul><ul>` and `</ol><ol>` the way mammoth would) but never with a
//   nested one;
// - an empty paragraph renders nothing, which would let whatever follows it
//   merge across the cut, so a piece starts only with a paragraph carrying
//   text mammoth renders;
// - footnote and endnote numbers run through the whole document and the notes
//   are listed once at the end, which the join restores.
// Anything else declines: an embedded style map (it could merge other
// elements), a namespace bound to an unexpected prefix, unreadable XML, and a
// body with no place to cut, such as one long table.
export const DOCX_BODY_CHUNK_BYTES = 2 * 1024 * 1024;

const OFFICE_DOCUMENT_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMBERING_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const EMBEDDED_STYLE_MAP_PART = 'mammoth/style-map';
const BODY_OPEN = /<w:body(?:\s[^>]*)?>/;
const BODY_CLOSE = '</w:body>';

const EXPECTED_PREFIX_BY_NAMESPACE = new Map([
  ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w'],
  ['http://schemas.openxmlformats.org/markup-compatibility/2006', 'mc'],
  ['urn:schemas-microsoft-com:vml', 'v'],
  [
    'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'wp',
  ],
]);
const EXPECTED_NAMESPACE_BY_PREFIX = new Map(
  [...EXPECTED_PREFIX_BY_NAMESPACE].map(([uri, prefix]) => [prefix, uri])
);

// The elements whose children mammoth's body reader reads; any other element
// is skipped whole, so text and field characters inside it never render.
const READ_CHILDREN = new Set([
  'w:body',
  'w:p',
  'w:r',
  'w:hyperlink',
  'w:tbl',
  'w:tr',
  'w:tc',
  'w:sdt',
  'w:sdtContent',
  'mc:AlternateContent',
  'mc:Fallback',
  'w:customXml',
  'w:ins',
  'w:moveTo',
  'w:object',
  'w:smartTag',
  'w:drawing',
  'w:pict',
  'v:roundrect',
  'v:shape',
  'v:textbox',
  'w:txbxContent',
  'v:group',
  'v:rect',
]);

export interface DocxBodyChunks {
  count: number;
  docxAt(index: number): Buffer;
}

interface Frame {
  name: string;
  read: boolean;
  inTextBox: boolean;
  paragraph?: ParagraphState;
}

interface ParagraphState {
  deleted: boolean;
}

interface TopLevelElement {
  start: number;
  isParagraph: boolean;
  hasText: boolean;
  deleted: boolean;
  numberingLevel?: string;
  numberingId?: string;
  style?: string;
  fieldDepthBefore: number;
  deletedMarkPendingBefore: boolean;
}

class UnreadableDocument extends Error {}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString(
    'latin1'
  );
}

function relationshipTargets(rels: string, type: string): string[] {
  const targets: string[] = [];
  for (const match of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const tag = match[0];
    if (!tag.includes(`Type="${type}"`)) continue;
    const target = /Target="([^"]+)"/.exec(tag);
    if (target) targets.push(target[1]);
  }
  return targets;
}

// The part mammoth reads: the first related target that exists in the zip,
// joined to the base path as mammoth joins it, or its fixed fallback.
function partPath(
  rels: string,
  type: string,
  basePath: string,
  fallback: string,
  names: Map<string, number>
): string {
  for (const target of relationshipTargets(rels, type)) {
    const joined = target.startsWith('/')
      ? target.slice(1)
      : [basePath, target].filter(Boolean).join('/');
    if (names.has(joined)) return joined;
  }
  return fallback;
}

function directoryOf(part: string): string {
  const slash = part.lastIndexOf('/');
  return slash === -1 ? '' : part.slice(0, slash);
}

function relsPartOf(part: string): string {
  const directory = directoryOf(part);
  const file = part.slice(part.lastIndexOf('/') + 1);
  return [directory, '_rels', `${file}.rels`].filter(Boolean).join('/');
}

function unzipParts(
  contents: Buffer,
  names: Set<string>
): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(contents), {
    filter: (file) => names.has(file.name),
  });
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

function namespacesAreExpected(xml: string): boolean {
  for (const match of xml.matchAll(/xmlns(?::([\w.-]+))?="([^"]*)"/g)) {
    const prefix = match[1] ?? '';
    const uri = match[2];
    const expectedPrefix = EXPECTED_PREFIX_BY_NAMESPACE.get(uri);
    if (expectedPrefix != null && expectedPrefix !== prefix) return false;
    const expectedUri = EXPECTED_NAMESPACE_BY_PREFIX.get(prefix);
    if (expectedUri != null && expectedUri !== uri) return false;
  }
  return true;
}

// Which list levels each paragraph style is linked to, as mammoth resolves a
// paragraph with a list style and no level of its own.
function styleListLevels(numberingXml: string): Map<string, Set<string>> {
  const levels = new Map<string, Set<string>>();
  let from = 0;
  for (;;) {
    const start = numberingXml.indexOf('<w:lvl', from);
    if (start === -1) break;
    const end = numberingXml.indexOf('</w:lvl>', start);
    const block = numberingXml.slice(start, end === -1 ? undefined : end);
    from = end === -1 ? numberingXml.length : end;
    const style = /<w:pStyle\s[^>]*w:val="([^"]*)"/.exec(block);
    if (style == null) continue;
    const level = /^<w:lvl\s[^>]*w:ilvl="([^"]*)"/.exec(block)?.[1] ?? '0';
    const set = levels.get(style[1]) ?? new Set<string>();
    set.add(level);
    levels.set(style[1], set);
  }
  return levels;
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
  throw new UnreadableDocument();
}

function skipMarkup(xml: string, at: number): number | null {
  for (const [open, close] of [
    ['<!--', '-->'],
    ['<![CDATA[', ']]>'],
    ['<?', '?>'],
  ]) {
    if (!xml.startsWith(open, at)) continue;
    const end = xml.indexOf(close, at);
    if (end === -1) throw new UnreadableDocument();
    return end + close.length;
  }
  return null;
}

function tagName(tag: string): string {
  const match = /^<\/?([^\s/>]+)/.exec(tag);
  if (match == null) throw new UnreadableDocument();
  return match[1];
}

function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

function childIsRead(parent: Frame): boolean {
  return parent.read && READ_CHILDREN.has(parent.name);
}

// One pass over the body: the top-level elements, and for each the state
// mammoth's reader carries into it.
function scanBody(xml: string, from: number, to: number): TopLevelElement[] {
  const elements: TopLevelElement[] = [];
  const stack: Frame[] = [{ name: 'w:body', read: true, inTextBox: false }];
  let fieldDepth = 0;
  let deletedMarkPending = false;
  let current: TopLevelElement | null = null;
  let containsDeletedMark = false;
  let containsKeptParagraph = false;

  const finishElement = () => {
    if (containsDeletedMark) deletedMarkPending = true;
    else if (containsKeptParagraph) deletedMarkPending = false;
    current = null;
  };

  let cursor = from;
  while (cursor < to) {
    const open = xml.indexOf('<', cursor);
    if (open === -1 || open >= to) break;
    const skipped = skipMarkup(xml, open);
    if (skipped != null) {
      cursor = skipped;
      continue;
    }
    const close = tagEnd(xml, open);
    if (close >= to) throw new UnreadableDocument();
    const tag = xml.slice(open, close + 1);
    const name = tagName(tag);
    cursor = close + 1;

    if (tag.startsWith('</')) {
      const frame = stack.pop();
      if (frame == null || frame.name !== name || stack.length === 0) {
        throw new UnreadableDocument();
      }
      if (frame.paragraph != null && frame.read && !frame.paragraph.deleted) {
        containsKeptParagraph = true;
      }
      if (stack.length === 1) finishElement();
      continue;
    }

    const parent = stack[stack.length - 1];
    const selfClosing = tag.endsWith('/>');
    if (stack.length === 1) {
      current = {
        start: open,
        isParagraph: name === 'w:p',
        hasText: false,
        deleted: false,
        fieldDepthBefore: fieldDepth,
        deletedMarkPendingBefore: deletedMarkPending,
      };
      elements.push(current);
      containsDeletedMark = false;
      containsKeptParagraph = false;
    }
    const element = current as TopLevelElement | null;
    const read = childIsRead(parent);
    const frame: Frame = {
      name,
      read,
      inTextBox: parent.inTextBox || name === 'w:txbxContent',
      paragraph: name === 'w:p' ? { deleted: false } : undefined,
    };

    const grandparent = stack[stack.length - 2];
    const greatGrandparent = stack[stack.length - 3];
    if (
      name === 'w:del' &&
      parent.name === 'w:rPr' &&
      grandparent?.name === 'w:pPr' &&
      greatGrandparent?.paragraph != null &&
      greatGrandparent.read
    ) {
      greatGrandparent.paragraph.deleted = true;
      containsDeletedMark = true;
      if (stack.length === 4 && element != null) element.deleted = true;
    }
    if (name === 'w:del' && parent.name === 'w:trPr' && grandparent != null) {
      grandparent.read = false;
    }
    if (read && name === 'w:fldChar' && parent.name === 'w:r') {
      const type = attribute(tag, 'w:fldCharType');
      if (type === 'begin') fieldDepth += 1;
      if (type === 'end') fieldDepth = Math.max(0, fieldDepth - 1);
    }
    if (
      read &&
      name === 'w:t' &&
      parent.name === 'w:r' &&
      !parent.inTextBox &&
      !selfClosing &&
      xml.charCodeAt(close + 1) !== 0x3c &&
      element != null &&
      stack.length >= 3
    ) {
      element.hasText = true;
    }
    if (element != null && stack.length >= 3 && stack[1].name === 'w:p') {
      collectNumbering(element, stack, name, tag);
    }

    if (selfClosing) {
      if (stack.length === 1) finishElement();
    } else {
      stack.push(frame);
    }
  }
  if (stack.length !== 1) throw new UnreadableDocument();
  return elements;
}

function collectNumbering(
  element: TopLevelElement,
  stack: Frame[],
  name: string,
  tag: string
): void {
  const path = stack.slice(2).map((frame) => frame.name);
  if (path[0] !== 'w:pPr') return;
  if (path.length === 1 && name === 'w:pStyle') {
    element.style ??= attribute(tag, 'w:val');
  }
  if (path.length === 2 && path[1] === 'w:numPr') {
    if (name === 'w:ilvl') element.numberingLevel ??= attribute(tag, 'w:val');
    if (name === 'w:numId') element.numberingId ??= attribute(tag, 'w:val');
  }
}

// mammoth resolves a list level from the paragraph's own level and list when
// it has both, then from a list-linked style, then level 0 of its list. A
// piece may only start with a paragraph that resolves to no list or to a
// top-level item.
function startsTopLevel(
  element: TopLevelElement,
  styleLevels: Map<string, Set<string>>
): boolean {
  if (element.numberingLevel != null && element.numberingId != null) {
    return element.numberingLevel === '0';
  }
  const linked = element.style == null ? null : styleLevels.get(element.style);
  if (linked != null) return linked.size === 1 && linked.has('0');
  return true;
}

function cutOffsets(
  elements: TopLevelElement[],
  styleLevels: Map<string, Set<string>>,
  bodyStart: number,
  chunkBytes: number
): number[] {
  const cuts: number[] = [];
  let chunkStart = bodyStart;
  for (const element of elements) {
    const safe =
      element.isParagraph &&
      element.hasText &&
      !element.deleted &&
      element.fieldDepthBefore === 0 &&
      !element.deletedMarkPendingBefore &&
      startsTopLevel(element, styleLevels);
    if (safe && element.start - chunkStart >= chunkBytes) {
      cuts.push(element.start);
      chunkStart = element.start;
    }
  }
  return cuts;
}

function readText(contents: Buffer, part: string): string {
  const bytes = unzipParts(contents, new Set([part]))[part];
  return bytes == null ? '' : latin1(bytes);
}

function planCuts(
  contents: Buffer,
  sizes: Map<string, number>,
  documentPart: string,
  chunkBytes: number
): { xml: string; bodyStart: number; bodyEnd: number; cuts: number[] } | null {
  const rels = readText(contents, relsPartOf(documentPart));
  const numberingPart = partPath(
    rels,
    NUMBERING_REL,
    directoryOf(documentPart),
    'word/numbering.xml',
    sizes
  );
  const parts = unzipParts(contents, new Set([documentPart, numberingPart]));
  const documentBytes = parts[documentPart];
  if (documentBytes == null) return null;
  const xml = latin1(documentBytes);
  if (!namespacesAreExpected(xml)) return null;
  const bodyOpen = BODY_OPEN.exec(xml);
  const bodyEnd = xml.lastIndexOf(BODY_CLOSE);
  if (bodyOpen == null || bodyEnd === -1) return null;
  const bodyStart = bodyOpen.index + bodyOpen[0].length;
  const numbering = parts[numberingPart];
  const styleLevels = styleListLevels(numbering ? latin1(numbering) : '');
  const elements = scanBody(xml, bodyStart, bodyEnd);
  const cuts = cutOffsets(elements, styleLevels, bodyStart, chunkBytes);
  return cuts.length === 0 ? null : { xml, bodyStart, bodyEnd, cuts };
}

export function splitDocxBody(
  contents: Buffer,
  chunkBytes: number
): DocxBodyChunks | null {
  try {
    const sizes = declaredPartSizes(contents);
    if (sizes.has(EMBEDDED_STYLE_MAP_PART)) return null;
    const documentPart = partPath(
      readText(contents, '_rels/.rels'),
      OFFICE_DOCUMENT_REL,
      '',
      'word/document.xml',
      sizes
    );
    if ((sizes.get(documentPart) ?? 0) <= chunkBytes) return null;
    const plan = planCuts(contents, sizes, documentPart, chunkBytes);
    if (plan == null) return null;

    const { xml, bodyStart, bodyEnd, cuts } = plan;
    const entries = unzipSync(new Uint8Array(contents), {
      filter: (file) => file.name !== documentPart,
    });
    const bounds = [bodyStart, ...cuts, bodyEnd];
    const head = xml.slice(0, bodyStart);
    const tail = xml.slice(bodyEnd);
    const otherEntries: Zippable = {};
    for (const [name, bytes] of Object.entries(entries)) {
      otherEntries[name] = [bytes, { level: 0 }];
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
const MERGING_LISTS = ['ul', 'ol'];

function trailingNotesStart(html: string): number {
  let start = -1;
  for (const match of html.matchAll(NOTES_LIST)) start = match.index;
  return start !== -1 && html.endsWith('</ol>') ? start : -1;
}

function appendBody(bodies: string[], body: string): void {
  if (body.length === 0) return;
  const last = bodies.length - 1;
  for (const list of MERGING_LISTS) {
    const close = `</${list}>`;
    const open = `<${list}>`;
    if (last >= 0 && bodies[last].endsWith(close) && body.startsWith(open)) {
      bodies[last] = bodies[last].slice(0, -close.length);
      bodies.push(body.slice(open.length));
      return;
    }
  }
  bodies.push(body);
}

// Each piece numbers its note references from 1 and lists its own notes after
// its body; the whole document numbers them in one sequence and lists every
// note once, at the end. A list cut between two top-level items comes back as
// two lists, which mammoth would have written as one.
export function joinDocxChunkHtml(chunks: string[]): string {
  const bodies: string[] = [];
  const notes: string[] = [];
  let notesBefore = 0;
  for (const html of chunks) {
    const notesStart = trailingNotesStart(html);
    const body = notesStart === -1 ? html : html.slice(0, notesStart);
    let references = 0;
    appendBody(
      bodies,
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
