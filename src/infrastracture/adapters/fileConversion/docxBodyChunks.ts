import { unzipSync, zipSync, type Zippable } from 'fflate';

import { UnreadableDocument, XmlTagReader } from './docxXmlTags';

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
// - footnote and endnote numbers run through the whole document, notes cited
//   inside notes continue after them, and the notes are listed once at the
//   end, which the join restores.
// Anything else declines: an embedded style map (it could merge other
// elements), a namespace bound to an unexpected prefix, XML the tag reader
// does not fully understand (an entity in a value it needs, nesting deeper
// than any Word document, markup it cannot place), planning that runs past
// its time budget, and a body with no place to cut, such as one long table.
export const DOCX_BODY_CHUNK_BYTES = 2 * 1024 * 1024;

// Planning runs in the web process too (the upload census and chat
// attachments), where it blocks every request while it reads. Reading is
// linear (about 0.4 s for the 47 MB body of a 10 MB file, measured locally),
// and past this budget the file is converted whole, as before.
export const DOCX_SPLIT_BUDGET_MS = 2000;
const MAX_ELEMENT_DEPTH = 256;

const OFFICE_DOCUMENT_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const NUMBERING_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering';
const EMBEDDED_STYLE_MAP_PART = 'mammoth/style-map';

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
  propertiesSeen: boolean;
  numberingLevel?: string;
  numberingId?: string;
  style?: string;
  fieldDepthBefore: number;
  deletedMarkPendingBefore: boolean;
}

interface DocumentScan {
  bodyStart: number;
  bodyEnd: number;
  elements: TopLevelElement[];
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString(
    'latin1'
  );
}

function checkNamespaces(reader: XmlTagReader): void {
  if (!reader.declaresNamespace()) return;
  reader.forEachAttribute((name, uri) => {
    if (name !== 'xmlns' && !name.startsWith('xmlns:')) return;
    const prefix = name === 'xmlns' ? '' : name.slice('xmlns:'.length);
    const expectedPrefix = EXPECTED_PREFIX_BY_NAMESPACE.get(uri);
    const expectedUri = EXPECTED_NAMESPACE_BY_PREFIX.get(prefix);
    if (
      uri.includes('&') ||
      (expectedPrefix != null && expectedPrefix !== prefix) ||
      (expectedUri != null && expectedUri !== uri)
    ) {
      throw new UnreadableDocument();
    }
  });
}

function pushFrame(stack: Frame[], frame: Frame): void {
  if (stack.length >= MAX_ELEMENT_DEPTH) throw new UnreadableDocument();
  stack.push(frame);
}

function popFrame(stack: Frame[], name: string): Frame {
  const frame = stack.pop();
  if (frame == null || frame.name !== name) throw new UnreadableDocument();
  return frame;
}

function relationshipTargets(
  rels: string,
  type: string,
  deadline: number
): string[] {
  const targets: string[] = [];
  const reader = new XmlTagReader(rels, 0, rels.length, deadline);
  const stack: Frame[] = [];
  while (reader.next()) {
    if (reader.kind === 'close') {
      popFrame(stack, reader.name);
      continue;
    }
    if (reader.name === 'Relationship' && reader.attribute('Type') === type) {
      const target = reader.attribute('Target');
      if (target != null) targets.push(target);
    }
    if (reader.kind === 'open') {
      pushFrame(stack, { name: reader.name, read: false, inTextBox: false });
    }
  }
  if (stack.length !== 0) throw new UnreadableDocument();
  return targets;
}

// The part mammoth reads: the first related target that exists in the zip,
// joined to the base path as mammoth joins it, or its fixed fallback.
function partPath(
  rels: string,
  type: string,
  basePath: string,
  fallback: string,
  names: Map<string, number>,
  deadline: number
): string {
  for (const target of relationshipTargets(rels, type, deadline)) {
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

// Which list levels each paragraph style is linked to, as mammoth resolves a
// paragraph with a list style and no level of its own: a w:pStyle directly
// inside a w:lvl.
function styleListLevels(
  numberingXml: string,
  deadline: number
): Map<string, Set<string>> {
  const levels = new Map<string, Set<string>>();
  const reader = new XmlTagReader(
    numberingXml,
    0,
    numberingXml.length,
    deadline
  );
  const stack: Frame[] = [];
  const levelOf: (string | undefined)[] = [];
  while (reader.next()) {
    if (reader.kind === 'close') {
      popFrame(stack, reader.name);
      levelOf.pop();
      continue;
    }
    checkNamespaces(reader);
    const parent = stack[stack.length - 1];
    if (reader.name === 'w:pStyle' && parent?.name === 'w:lvl') {
      const style = reader.attribute('w:val');
      const level = levelOf[levelOf.length - 1] ?? '0';
      if (style != null) {
        const set = levels.get(style) ?? new Set<string>();
        set.add(level);
        levels.set(style, set);
      }
    }
    if (reader.kind === 'open') {
      const level =
        reader.name === 'w:lvl' ? reader.attribute('w:ilvl') : undefined;
      pushFrame(stack, { name: reader.name, read: false, inTextBox: false });
      levelOf.push(level);
    }
  }
  if (stack.length !== 0) throw new UnreadableDocument();
  return levels;
}

function childIsRead(parent: Frame): boolean {
  return parent.read && READ_CHILDREN.has(parent.name);
}

// One pass over word/document.xml: where the body starts and ends, its
// top-level elements, and for each the state mammoth's reader carries into it.
// The stack holds w:document, then w:body, then the element being read, so a
// top-level element is stack[2], its properties stack[3], and so on.
function scanDocument(xml: string, deadline: number): DocumentScan {
  const reader = new XmlTagReader(xml, 0, xml.length, deadline);
  const elements: TopLevelElement[] = [];
  const stack: Frame[] = [];
  let bodyStart = -1;
  let bodyEnd = -1;
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

  while (reader.next()) {
    const name = reader.name;
    if (reader.kind === 'close') {
      const frame = popFrame(stack, name);
      if (frame.paragraph != null && frame.read && !frame.paragraph.deleted) {
        containsKeptParagraph = true;
      }
      if (stack.length === 1 && name === 'w:body') bodyEnd = reader.start;
      const inBody = stack[1]?.name === 'w:body' && bodyEnd === -1;
      if (inBody && stack.length === 3 && name === 'w:pPr' && current) {
        (current as TopLevelElement).propertiesSeen = true;
      }
      if (inBody && stack.length === 2) finishElement();
      continue;
    }
    checkNamespaces(reader);

    if (stack.length === 0) {
      if (name !== 'w:document' || reader.kind !== 'open') {
        throw new UnreadableDocument();
      }
      pushFrame(stack, { name, read: false, inTextBox: false });
      continue;
    }
    if (stack.length === 1) {
      if (name === 'w:body') {
        if (bodyStart !== -1) throw new UnreadableDocument();
        bodyStart = reader.end + 1;
        if (reader.kind === 'empty') {
          bodyEnd = bodyStart;
          continue;
        }
        pushFrame(stack, { name, read: true, inTextBox: false });
        continue;
      }
      if (reader.kind === 'open') {
        pushFrame(stack, { name, read: false, inTextBox: false });
      }
      continue;
    }

    const insideBody = stack[1].name === 'w:body' && bodyEnd === -1;
    const parent = stack[stack.length - 1];
    if (insideBody && stack.length === 2) {
      current = {
        start: reader.start,
        isParagraph: name === 'w:p',
        hasText: false,
        deleted: false,
        propertiesSeen: false,
        fieldDepthBefore: fieldDepth,
        deletedMarkPendingBefore: deletedMarkPending,
      };
      elements.push(current);
      containsDeletedMark = false;
      containsKeptParagraph = false;
    }
    const element = insideBody ? (current as TopLevelElement | null) : null;
    const read = childIsRead(parent);

    if (element != null) {
      noteDeletions(stack, name, element, () => {
        containsDeletedMark = true;
      });
      if (read && name === 'w:fldChar' && parent.name === 'w:r') {
        const type = reader.attribute('w:fldCharType');
        if (type === 'begin') fieldDepth += 1;
        if (type === 'end') fieldDepth = Math.max(0, fieldDepth - 1);
      }
      if (
        read &&
        name === 'w:t' &&
        parent.name === 'w:r' &&
        !parent.inTextBox &&
        reader.kind === 'open' &&
        reader.textFollows() &&
        stack.length >= 4
      ) {
        element.hasText = true;
      }
      if (element.isParagraph) collectNumbering(element, stack, reader);
    }

    if (reader.kind === 'open') {
      pushFrame(stack, {
        name,
        read,
        inTextBox: parent.inTextBox || name === 'w:txbxContent',
        paragraph: name === 'w:p' ? { deleted: false } : undefined,
      });
    } else if (insideBody && stack.length === 2) {
      finishElement();
    }
  }
  if (stack.length !== 0 || bodyStart === -1 || bodyEnd === -1) {
    throw new UnreadableDocument();
  }
  return { bodyStart, bodyEnd, elements };
}

function noteDeletions(
  stack: Frame[],
  name: string,
  element: TopLevelElement,
  onDeletedMark: () => void
): void {
  if (name !== 'w:del') return;
  const depth = stack.length;
  const parent = stack[depth - 1];
  const grandparent = stack[depth - 2];
  const paragraph = stack[depth - 3];
  if (
    parent.name === 'w:rPr' &&
    grandparent?.name === 'w:pPr' &&
    paragraph?.paragraph != null &&
    paragraph.read
  ) {
    paragraph.paragraph.deleted = true;
    onDeletedMark();
    if (depth === 5) element.deleted = true;
  }
  if (parent.name === 'w:trPr' && grandparent != null) {
    grandparent.read = false;
  }
}

// The first w:pPr of the top-level paragraph: its w:pStyle and the w:ilvl and
// w:numId of its w:numPr, as mammoth reads them with firstOrEmpty.
function collectNumbering(
  element: TopLevelElement,
  stack: Frame[],
  reader: XmlTagReader
): void {
  const depth = stack.length;
  const name = reader.name;
  if (depth === 3 && name === 'w:pPr') {
    if (reader.kind === 'empty') element.propertiesSeen = true;
    return;
  }
  if (stack[3]?.name !== 'w:pPr' || element.propertiesSeen) return;
  if (depth === 4 && name === 'w:pStyle') {
    element.style ??= reader.attribute('w:val');
  } else if (depth === 5 && stack[4].name === 'w:numPr') {
    if (name === 'w:ilvl') element.numberingLevel ??= reader.attribute('w:val');
    if (name === 'w:numId') element.numberingId ??= reader.attribute('w:val');
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
  chunkBytes: number,
  deadline: number
): { xml: string; bodyStart: number; bodyEnd: number; cuts: number[] } | null {
  const rels = readText(contents, relsPartOf(documentPart));
  const numberingPart = partPath(
    rels,
    NUMBERING_REL,
    directoryOf(documentPart),
    'word/numbering.xml',
    sizes,
    deadline
  );
  const parts = unzipParts(contents, new Set([documentPart, numberingPart]));
  const documentBytes = parts[documentPart];
  if (documentBytes == null) return null;
  const xml = latin1(documentBytes);
  const numbering = parts[numberingPart];
  const styleLevels = styleListLevels(
    numbering ? latin1(numbering) : '',
    deadline
  );
  const { bodyStart, bodyEnd, elements } = scanDocument(xml, deadline);
  const cuts = cutOffsets(elements, styleLevels, bodyStart, chunkBytes);
  return cuts.length === 0 ? null : { xml, bodyStart, bodyEnd, cuts };
}

export function splitDocxBody(
  contents: Buffer,
  chunkBytes: number
): DocxBodyChunks | null {
  const deadline = Date.now() + DOCX_SPLIT_BUDGET_MS;
  try {
    const sizes = declaredPartSizes(contents);
    if (sizes.has(EMBEDDED_STYLE_MAP_PART)) return null;
    const documentPart = partPath(
      readText(contents, '_rels/.rels'),
      OFFICE_DOCUMENT_REL,
      '',
      'word/document.xml',
      sizes,
      deadline
    );
    if ((sizes.get(documentPart) ?? 0) <= chunkBytes) return null;
    const plan = planCuts(contents, sizes, documentPart, chunkBytes, deadline);
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

function renumberNoteReferences(
  html: string,
  renumber: (label: number) => number
): { html: string; references: number } {
  let references = 0;
  const renumbered = html.replace(
    NOTE_REFERENCE_LABEL,
    (_match: string, open: string, label: string, close: string) => {
      references += 1;
      return `${open}${renumber(Number(label))}${close}`;
    }
  );
  return { html: renumbered, references };
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

interface PieceNotes {
  html: string;
  bodyReferences: number;
}

// Each piece numbers its note references from 1 and lists its own notes after
// its body; the whole document numbers them in one sequence, numbers a note
// cited inside a note after every citation in the body, and lists every note
// once, at the end. A list cut between two top-level items comes back as two
// lists, which mammoth would have written as one.
export function joinDocxChunkHtml(chunks: string[]): string {
  const bodies: string[] = [];
  const pieceNotes: PieceNotes[] = [];
  let bodyReferences = 0;
  for (const html of chunks) {
    const notesStart = trailingNotesStart(html);
    const offset = bodyReferences;
    const body = renumberNoteReferences(
      notesStart === -1 ? html : html.slice(0, notesStart),
      (label) => label + offset
    );
    appendBody(bodies, body.html);
    bodyReferences += body.references;
    if (notesStart !== -1) {
      pieceNotes.push({
        html: html.slice(notesStart + '<ol>'.length, -'</ol>'.length),
        bodyReferences: body.references,
      });
    }
  }
  let nestedBefore = 0;
  const notes = pieceNotes.map((piece) => {
    const before = nestedBefore;
    const renumbered = renumberNoteReferences(
      piece.html,
      (label) => label - piece.bodyReferences + bodyReferences + before
    );
    nestedBefore += renumbered.references;
    return renumbered.html;
  });
  const notesList = notes.length > 0 ? `<ol>${notes.join('')}</ol>` : '';
  return bodies.join('') + notesList;
}
