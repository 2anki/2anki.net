import {
  inflateEntry,
  readZipDirectory,
  replaceZipEntry,
  type ZipDirectory,
} from './docxZip';
import { UnreadableDocument, XmlTagReader } from './docxXmlTags';

// mammoth holds the parsed XML, its own element tree, the document model and
// two copies of the HTML tree at once: about 40 bytes of heap per byte of
// word/document.xml. A long Word document (tens of MB of XML) therefore runs
// a 1 GB conversion child out of heap. Splitting the body between top-level
// paragraphs and converting each piece in turn bounds that working set to one
// piece; the joined HTML is the HTML mammoth writes for the whole document.
//
// Splitting must be earned: the splitter only cuts a package it positively
// recognises and returns null for anything else, so the file converts whole
// exactly as before. Recognised means:
// - the zip directory reads plainly (no zip64, encryption, duplicate or
//   non-ASCII names) and every size is under its cap before anything inflates;
// - every relationships part it reads is exactly the standard package
//   relationships element holding only Relationship elements, so the main
//   document and numbering parts resolve as mammoth resolves them;
// - every namespace a mammoth name depends on is bound to its standard prefix
//   and every element prefix is in scope; no mc: element appears anywhere
//   (mammoth folds alternate content into its parent before reading);
// - every element mammoth reads in the body is on READ_CHILDREN or
//   READ_LEAVES below, and no element it reads only once (READ_ONCE) appears
//   twice;
// - planning finishes inside its time budget.
// Within that, a cut is placed only where mammoth carries no state across it:
// not while a complex field (HYPERLINK, FORMCHECKBOX) is open, not after a
// deleted paragraph mark that the next paragraph would absorb, not before a
// nested list item (it merges into the item before it), and only before a
// paragraph carrying text mammoth renders. A piece may start with a top-level
// list item: the join merges `</ul><ul>` and `</ol><ol>` as mammoth's collapse
// step would, and renumbers footnotes and endnotes into one sequence listed
// once at the end.
export const DOCX_BODY_CHUNK_BYTES = 2 * 1024 * 1024;

// Planning runs inside the conversion worker only, but a file that is slow to
// read still converts whole rather than splitting late. Reading is linear
// (about 0.4 s for the 47 MB body of a 10 MB file, measured locally).
export const DOCX_SPLIT_BUDGET_MS = 2000;

// The whole pipeline after splitting stays under the 1 GB child heap up to
// about this much body XML (a 97 MB body measured at 537 MB of heap).
export const MAX_SPLIT_DOCUMENT_BYTES = 128 * 1024 * 1024;

// Parts mammoth reads again in every piece: styles, numbering, notes,
// comments and their relationships. Above this, pieces would multiply the
// cost, so the file converts whole.
export const MAX_SHARED_PART_BYTES = 2 * 1024 * 1024;

// Every other entry is copied into each piece as it is, still compressed.
export const MAX_OTHER_PART_BYTES = 256 * 1024 * 1024;

const MAX_ELEMENT_DEPTH = 256;

const RELATIONSHIP_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const PACKAGE_RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships';
const EMBEDDED_STYLE_MAP_PART = 'mammoth/style-map';
const SHARED_PARTS = [
  'styles',
  'numbering',
  'footnotes',
  'endnotes',
  'comments',
];
const RESOLVED_TYPES = new Set(
  ['officeDocument', ...SHARED_PARTS].map((name) => RELATIONSHIP_TYPE + name)
);

// Namespaces mammoth gives a name to, with the prefix this file reads them
// under. The strict-format namespaces are absent on purpose: any binding of
// them declines.
const PREFIX_BY_NAMESPACE = new Map([
  ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w'],
  ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r'],
  [
    'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'wp',
  ],
  ['http://schemas.openxmlformats.org/drawingml/2006/main', 'a'],
  ['http://schemas.openxmlformats.org/drawingml/2006/picture', 'pic'],
  ['http://schemas.openxmlformats.org/markup-compatibility/2006', 'mc'],
  ['urn:schemas-microsoft-com:vml', 'v'],
  ['urn:schemas-microsoft-com:office:word', 'w10'],
  ['http://schemas.microsoft.com/office/word/2010/wordml', 'w14'],
]);
const NAMESPACE_BY_PREFIX = new Map(
  [...PREFIX_BY_NAMESPACE].map(([uri, prefix]) => [prefix, uri])
);
const MAMMOTH_ONLY_NAMESPACES = [
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
  'http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing',
  'http://purl.oclc.org/ooxml/drawingml/main',
  'http://purl.oclc.org/ooxml/drawingml/picture',
  'http://schemas.openxmlformats.org/package/2006/content-types',
  PACKAGE_RELATIONSHIPS_NAMESPACE,
];

// mammoth's body reader reads the children of these elements.
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

// Elements mammoth reads as a leaf or skips with their whole subtree, none of
// which carries state to the next top-level element.
const READ_LEAVES = new Set([
  'w:pPr',
  'w:rPr',
  'w:tblPr',
  'w:tblGrid',
  'w:tblPrEx',
  'w:trPr',
  'w:tcPr',
  'w:sectPr',
  'w:sdtPr',
  'w:sdtEndPr',
  'w:t',
  'w:delText',
  'w:instrText',
  'w:delInstrText',
  'w:tab',
  'w:ptab',
  'w:br',
  'w:cr',
  'w:sym',
  'w:noBreakHyphen',
  'w:softHyphen',
  'w:fldChar',
  'w:fldSimple',
  'w:footnoteReference',
  'w:endnoteReference',
  'w:commentReference',
  'w:annotationRef',
  'w:footnoteRef',
  'w:endnoteRef',
  'w:separator',
  'w:continuationSeparator',
  'w:lastRenderedPageBreak',
  'w:bookmarkStart',
  'w:bookmarkEnd',
  'w:proofErr',
  'w:commentRangeStart',
  'w:commentRangeEnd',
  'w:del',
  'w:moveFrom',
  'w:moveFromRangeStart',
  'w:moveFromRangeEnd',
  'w:moveToRangeStart',
  'w:moveToRangeEnd',
  'w:permStart',
  'w:permEnd',
  'wp:inline',
  'wp:anchor',
  'v:imagedata',
  'v:shapetype',
  'v:shadow',
  'v:stroke',
  'v:fill',
  'v:path',
  'v:formulas',
  'v:handles',
  'v:textpath',
  'o:lock',
  'o:OLEObject',
  'w10:wrap',
  'w10:anchorlock',
  'm:oMath',
  'm:oMathPara',
]);

// mammoth reads only the first of these children, so a second one declines.
const READ_ONCE = new Map([
  ['w:document', new Set(['w:body'])],
  ['w:p', new Set(['w:pPr'])],
  ['w:pPr', new Set(['w:pStyle', 'w:numPr', 'w:rPr'])],
  ['w:numPr', new Set(['w:ilvl', 'w:numId'])],
  ['w:rPr', new Set(['w:del'])],
  ['w:r', new Set(['w:rPr'])],
  ['w:sdt', new Set(['w:sdtPr', 'w:sdtContent', 'w:sdtEndPr'])],
  ['w:tbl', new Set(['w:tblPr'])],
  ['w:tr', new Set(['w:trPr'])],
  ['w:tc', new Set(['w:tcPr'])],
  ['w:lvl', new Set(['w:pStyle'])],
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
  children?: Set<string>;
  declared?: string[];
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

interface Relationship {
  type: string;
  target: string;
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString(
    'latin1'
  );
}

function decline(): never {
  throw new UnreadableDocument();
}

function prefixOf(name: string): string | null {
  const colon = name.indexOf(':');
  return colon === -1 ? null : name.slice(0, colon);
}

// Namespace declarations, tracked in scope, so an element's prefix means to
// this file what its namespace means to mammoth.
class NamespaceScope {
  private readonly bound = new Map<string, number>();

  enter(reader: XmlTagReader, frame: Frame | null): void {
    if (!reader.declaresNamespace()) return;
    const declared: string[] = [];
    reader.forEachAttribute((name, uri) => {
      if (name === 'xmlns') decline();
      if (!name.startsWith('xmlns:')) return;
      const prefix = name.slice('xmlns:'.length);
      if (uri.includes('&') || MAMMOTH_ONLY_NAMESPACES.includes(uri)) {
        decline();
      }
      const expectedPrefix = PREFIX_BY_NAMESPACE.get(uri);
      const expectedUri = NAMESPACE_BY_PREFIX.get(prefix);
      if (expectedPrefix != null && expectedPrefix !== prefix) decline();
      if (expectedUri != null && expectedUri !== uri) decline();
      declared.push(prefix);
      this.bound.set(prefix, (this.bound.get(prefix) ?? 0) + 1);
    });
    if (frame == null) {
      for (const prefix of declared) this.leaveOne(prefix);
    } else if (declared.length > 0) {
      frame.declared = declared;
    }
  }

  leave(frame: Frame): void {
    for (const prefix of frame.declared ?? []) this.leaveOne(prefix);
  }

  requireBound(name: string): void {
    const prefix = prefixOf(name);
    if (prefix == null || (this.bound.get(prefix) ?? 0) === 0) decline();
    if (prefix === 'mc') decline();
  }

  private leaveOne(prefix: string): void {
    this.bound.set(prefix, (this.bound.get(prefix) ?? 1) - 1);
  }
}

function pushFrame(stack: Frame[], frame: Frame): void {
  if (stack.length >= MAX_ELEMENT_DEPTH) decline();
  stack.push(frame);
}

function popFrame(stack: Frame[], name: string): Frame {
  const frame = stack.pop();
  if (frame == null || frame.name !== name) decline();
  return frame;
}

function noteChild(parent: Frame | undefined, name: string): void {
  if (parent == null) return;
  const once = READ_ONCE.get(parent.name);
  if (once == null || !once.has(name)) return;
  parent.children ??= new Set();
  if (parent.children.has(name)) decline();
  parent.children.add(name);
}

// Exactly the standard package relationships element, holding only
// Relationship elements with no children: anything else could be read
// differently by mammoth, which reads relationships by namespace.
function readRelationships(xml: string, deadline: number): Relationship[] {
  const reader = new XmlTagReader(xml, 0, xml.length, deadline);
  const relationships: Relationship[] = [];
  let depth = 0;
  let rootSeen = false;
  while (reader.next()) {
    if (reader.kind === 'close') {
      depth -= 1;
      if (depth < 0) decline();
      continue;
    }
    if (depth === 0) {
      if (
        rootSeen ||
        reader.name !== 'Relationships' ||
        reader.kind !== 'open'
      ) {
        decline();
      }
      rootSeen = true;
      let namespaced = false;
      reader.forEachAttribute((name, value) => {
        if (name !== 'xmlns' || value !== PACKAGE_RELATIONSHIPS_NAMESPACE) {
          decline();
        }
        namespaced = true;
      });
      if (!namespaced) decline();
      depth = 1;
      continue;
    }
    if (depth !== 1 || reader.name !== 'Relationship') decline();
    let type: string | undefined;
    let target: string | undefined;
    reader.forEachAttribute((name, value) => {
      if (value.includes('&') && name !== 'Target') decline();
      if (name === 'Type') type = value;
      else if (name === 'Target') target = value;
      else if (name !== 'Id' && name !== 'TargetMode') decline();
    });
    if (type != null && target != null) {
      if (target.includes('&')) {
        if (RESOLVED_TYPES.has(type)) decline();
      } else {
        relationships.push({ type, target });
      }
    }
    if (reader.kind === 'open') depth = 2;
  }
  if (!rootSeen || depth !== 0) decline();
  return relationships;
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

// The part mammoth reads: the first related target that exists in the zip,
// joined to the base path as mammoth joins it, or its fixed fallback.
function partPath(
  relationships: Relationship[],
  type: string,
  basePath: string,
  fallback: string,
  directory: ZipDirectory
): string {
  for (const relationship of relationships) {
    if (relationship.type !== type) continue;
    const target = relationship.target;
    const joined = target.startsWith('/')
      ? target.slice(1)
      : [basePath, target].filter(Boolean).join('/');
    if (directory.entries.has(joined)) return joined;
  }
  return fallback;
}

function partText(
  contents: Buffer,
  directory: ZipDirectory,
  part: string
): string | null {
  const entry = directory.entries.get(part);
  return entry == null ? null : latin1(inflateEntry(contents, entry));
}

function sizeOf(directory: ZipDirectory, part: string): number {
  return directory.entries.get(part)?.size ?? 0;
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
  const namespaces = new NamespaceScope();
  const stack: Frame[] = [];
  const levelOf: (string | undefined)[] = [];
  while (reader.next()) {
    if (reader.kind === 'close') {
      namespaces.leave(popFrame(stack, reader.name));
      levelOf.pop();
      continue;
    }
    const frame: Frame = { name: reader.name, read: false, inTextBox: false };
    namespaces.enter(reader, reader.kind === 'open' ? frame : null);
    namespaces.requireBound(reader.name);
    const parent = stack[stack.length - 1];
    noteChild(parent, reader.name);
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
      pushFrame(stack, frame);
      levelOf.push(level);
    }
  }
  if (stack.length !== 0) decline();
  return levels;
}

function childIsRead(parent: Frame): boolean {
  return parent.read && READ_CHILDREN.has(parent.name);
}

function requireKnownReadElement(name: string): void {
  if (!READ_CHILDREN.has(name) && !READ_LEAVES.has(name)) decline();
}

// One pass over word/document.xml: where the body starts and ends, its
// top-level elements, and for each the state mammoth's reader carries into it.
// The stack holds w:document, then w:body, then the element being read, so a
// top-level element is stack[2], its properties stack[3], and so on.
function scanDocument(xml: string, deadline: number): DocumentScan {
  const reader = new XmlTagReader(xml, 0, xml.length, deadline);
  const namespaces = new NamespaceScope();
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
      namespaces.leave(frame);
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

    const parent = stack[stack.length - 1];
    const read = parent == null ? false : childIsRead(parent);
    const frame: Frame = {
      name,
      read: name === 'w:body' && stack.length === 1 ? true : read,
      inTextBox: (parent?.inTextBox ?? false) || name === 'w:txbxContent',
      paragraph: name === 'w:p' ? { deleted: false } : undefined,
    };
    namespaces.enter(reader, reader.kind === 'open' ? frame : null);
    namespaces.requireBound(name);
    noteChild(parent, name);

    if (stack.length === 0) {
      if (name !== 'w:document' || reader.kind !== 'open') decline();
      pushFrame(stack, frame);
      continue;
    }
    if (stack.length === 1) {
      if (name === 'w:body') {
        bodyStart = reader.end + 1;
        if (reader.kind === 'empty') {
          bodyEnd = bodyStart;
          continue;
        }
      }
      if (reader.kind === 'open') pushFrame(stack, frame);
      continue;
    }

    const insideBody = stack[1].name === 'w:body' && bodyEnd === -1;
    if (read && insideBody) requireKnownReadElement(name);
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
      pushFrame(stack, frame);
    } else if (insideBody && stack.length === 2) {
      finishElement();
    }
  }
  if (stack.length !== 0 || bodyStart === -1 || bodyEnd === -1) decline();
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

interface PackageParts {
  documentPart: string;
  numberingPart: string;
}

function withinBudget(deadline: number): void {
  if (Date.now() > deadline) decline();
}

// Resolves the parts mammoth reads and checks every size from the zip
// directory before anything but the relationships parts inflates.
function packageParts(
  contents: Buffer,
  directory: ZipDirectory,
  chunkBytes: number,
  deadline: number
): PackageParts | null {
  if (directory.entries.has(EMBEDDED_STYLE_MAP_PART)) return null;
  const packageRels = '_rels/.rels';
  if (sizeOf(directory, packageRels) > MAX_SHARED_PART_BYTES) return null;
  const packageText = partText(contents, directory, packageRels);
  const documentPart = partPath(
    packageText == null ? [] : readRelationships(packageText, deadline),
    `${RELATIONSHIP_TYPE}officeDocument`,
    '',
    'word/document.xml',
    directory
  );
  const documentSize = sizeOf(directory, documentPart);
  if (!directory.entries.has(documentPart)) return null;
  if (documentSize <= chunkBytes || documentSize > MAX_SPLIT_DOCUMENT_BYTES) {
    return null;
  }

  const documentRels = relsPartOf(documentPart);
  if (sizeOf(directory, documentRels) > MAX_SHARED_PART_BYTES) return null;
  const documentRelsText = partText(contents, directory, documentRels);
  const relationships =
    documentRelsText == null
      ? []
      : readRelationships(documentRelsText, deadline);
  const shared = SHARED_PARTS.map((name) =>
    partPath(
      relationships,
      `${RELATIONSHIP_TYPE}${name}`,
      directoryOf(documentPart),
      `word/${name}.xml`,
      directory
    )
  );
  const sharedNames = new Set([
    '[Content_Types].xml',
    packageRels,
    documentRels,
    ...shared,
    ...shared.map(relsPartOf),
  ]);
  let sharedBytes = 0;
  let otherBytes = 0;
  for (const entry of directory.order) {
    if (entry.name === documentPart) continue;
    if (sharedNames.has(entry.name)) sharedBytes += entry.size;
    else otherBytes += entry.size;
  }
  if (
    sharedBytes > MAX_SHARED_PART_BYTES ||
    otherBytes > MAX_OTHER_PART_BYTES
  ) {
    return null;
  }
  return { documentPart, numberingPart: shared[1] };
}

function planCuts(
  contents: Buffer,
  directory: ZipDirectory,
  parts: PackageParts,
  chunkBytes: number,
  deadline: number
): { xml: string; bodyStart: number; bodyEnd: number; cuts: number[] } | null {
  const numbering = partText(contents, directory, parts.numberingPart);
  withinBudget(deadline);
  const styleLevels = styleListLevels(numbering ?? '', deadline);
  const xml = partText(contents, directory, parts.documentPart);
  if (xml == null) return null;
  withinBudget(deadline);
  const { bodyStart, bodyEnd, elements } = scanDocument(xml, deadline);
  withinBudget(deadline);
  const cuts = cutOffsets(elements, styleLevels, bodyStart, chunkBytes);
  return cuts.length === 0 ? null : { xml, bodyStart, bodyEnd, cuts };
}

export function splitDocxBody(
  contents: Buffer,
  chunkBytes: number
): DocxBodyChunks | null {
  const deadline = Date.now() + DOCX_SPLIT_BUDGET_MS;
  try {
    const directory = readZipDirectory(contents);
    const parts = packageParts(contents, directory, chunkBytes, deadline);
    if (parts == null) return null;
    withinBudget(deadline);
    const plan = planCuts(contents, directory, parts, chunkBytes, deadline);
    if (plan == null) return null;

    const { xml, bodyStart, bodyEnd, cuts } = plan;
    const bounds = [bodyStart, ...cuts, bodyEnd];
    const head = xml.slice(0, bodyStart);
    const tail = xml.slice(bodyEnd);
    return {
      count: bounds.length - 1,
      docxAt(index: number): Buffer {
        const body = xml.slice(bounds[index], bounds[index + 1]);
        return replaceZipEntry(
          contents,
          directory,
          parts.documentPart,
          Buffer.from(head + body + tail, 'latin1')
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
