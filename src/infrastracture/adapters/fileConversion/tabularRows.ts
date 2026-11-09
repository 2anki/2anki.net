import * as XLSX from 'xlsx';

export type TabularRow = unknown[];

const isTsvFile = (fileName: string): boolean => /\.tsv$/i.test(fileName);

function firstLineHoldsTab(bytes: Buffer): boolean {
  const newline = bytes.indexOf(0x0a);
  const firstLine = bytes.subarray(0, newline === -1 ? bytes.length : newline);
  return firstLine.includes(0x09);
}

// Closed set (trio decision, #3945): English plus the three locales with real
// upload traffic — de, es, pt. A pair only drops row 0 when BOTH words match
// exactly, so every addition slightly widens the false-drop surface; extend on
// traffic evidence, not preemptively.
const FIELD_HEADER_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['front', 'back'],
  ['question', 'answer'],
  ['term', 'definition'],
  ['vorderseite', 'rückseite'],
  ['frage', 'antwort'],
  ['begriff', 'definition'],
  ['anverso', 'reverso'],
  ['pregunta', 'respuesta'],
  ['término', 'definición'],
  ['frente', 'verso'],
  ['pergunta', 'resposta'],
  ['termo', 'definição'],
];

export interface FieldColumns {
  frontIndex: number;
  backIndex: number;
}

export function cellText(cell: unknown): string {
  return cell == null ? '' : String(cell);
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export interface SheetRows {
  name: string;
  rows: TabularRow[];
}

// SheetJS keeps a UTF-8 byte order mark inside the first cell and, for a
// text file, guesses the separator by counting characters, so a .tsv whose
// cells hold commas splits on the commas. A .tsv whose first line holds a
// tab is read with the tab fixed as the separator (a mislabeled comma file
// keeps the guess); the mark is stripped for every text file.
function withoutByteOrderMark(buffer: Buffer): Buffer {
  return buffer.subarray(0, 3).equals(UTF8_BOM) ? buffer.subarray(3) : buffer;
}

function readWorkbook(buffer: Buffer, fileName: string): XLSX.WorkBook {
  const bytes = withoutByteOrderMark(buffer);
  return XLSX.read(bytes, {
    type: 'buffer',
    codepage: 65001,
    ...(isTsvFile(fileName) && firstLineHoldsTab(bytes) ? { FS: '\t' } : {}),
  });
}

function sheetRows(worksheet: XLSX.WorkSheet): TabularRow[] {
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
  }) as TabularRow[];
}

const LESS_THAN = 0x3c;
const LEADING_WHITESPACE = new Set([0x20, 0x0a, 0x0d]);
const TEXT_GUARD = 'x';
const MARKUP_DOCUMENT =
  /^<(\?xml|!doctype|!--|html\b|head\b|body\b|meta\b|style\b|script\b|table\b|([\w-]+:)?workbook\b)/i;

function withoutLeadingWhitespace(bytes: Buffer): Buffer {
  let start = 0;
  while (LEADING_WHITESPACE.has(bytes[start])) start += 1;
  return bytes.subarray(start);
}

function firstSheetRows(workbook: XLSX.WorkBook): TabularRow[] {
  return sheetRows(workbook.Sheets[workbook.SheetNames[0]]);
}

// A whole XML or HTML document saved under a text name. SheetJS reads the ones
// holding a table and throws on the rest; those have no rows to offer, and the
// empty deck that follows says so better than its internal error would.
function rowsFromMarkupDocument(bytes: Buffer, fileName: string): TabularRow[] {
  try {
    return firstSheetRows(readWorkbook(bytes, fileName));
  } catch (error) {
    console.warn('[csv] markup document has no readable table', {
      kind: (error as Error).name,
    });
    return [];
  }
}

// SheetJS reads any input opening with "<" as an XML or HTML workbook, once it
// has skipped whitespace, so a CSV whose first cell held a tag came back with
// no rows or threw. A guard letter sends it down the delimited path instead.
function rowsFromTextOpeningWithTag(
  bytes: Buffer,
  fileName: string
): TabularRow[] {
  const guarded = Buffer.concat([Buffer.from(TEXT_GUARD), bytes]);
  const [first, ...rest] = firstSheetRows(readWorkbook(guarded, fileName));
  const [cell, ...cells] = first;
  return [[cellText(cell).slice(TEXT_GUARD.length), ...cells], ...rest];
}

// A delimiter outside the tags on the first line is what separates a row like
// <div>Front</div>,Back from a document that merely opens with a <div>.
function opensWithDelimitedRow(bytes: Buffer): boolean {
  const newline = bytes.indexOf(0x0a);
  const firstLine = bytes
    .subarray(0, newline === -1 ? bytes.length : newline)
    .toString('latin1');
  return (
    !MARKUP_DOCUMENT.test(firstLine) &&
    /[,;\t]/.test(firstLine.replace(/<[^>]*>/g, ''))
  );
}

export function rowsFromBuffer(buffer: Buffer, fileName = ''): TabularRow[] {
  const bytes = withoutLeadingWhitespace(withoutByteOrderMark(buffer));
  if (bytes[0] !== LESS_THAN) {
    return firstSheetRows(readWorkbook(buffer, fileName));
  }
  return opensWithDelimitedRow(bytes)
    ? rowsFromTextOpeningWithTag(bytes, fileName)
    : rowsFromMarkupDocument(bytes, fileName);
}

// SheetJS keeps hidden and very hidden sheets in SheetNames, marking them in
// the parallel Workbook.Sheets array with Hidden === 1 (hidden) or 2 (very
// hidden). Those are lookup tables and helper tabs the author hid on purpose,
// so converting them turns junk rows into cards counted against the free limit.
function visibleSheetNames(workbook: XLSX.WorkBook): string[] {
  const properties = workbook.Workbook?.Sheets;
  return workbook.SheetNames.filter(
    (_name, index) => (properties?.[index]?.Hidden ?? 0) === 0
  );
}

export function sheetsFromBuffer(buffer: Buffer, fileName = ''): SheetRows[] {
  const workbook = readWorkbook(buffer, fileName);
  return visibleSheetNames(workbook).map((name) => ({
    name,
    rows: sheetRows(workbook.Sheets[name]),
  }));
}

export function detectFieldColumns(row: TabularRow): FieldColumns | null {
  const normalized = row.map((cell) => cellText(cell).trim().toLowerCase());
  for (const [frontName, backName] of FIELD_HEADER_PAIRS) {
    const frontIndex = normalized.indexOf(frontName);
    const backIndex = normalized.indexOf(backName);
    if (frontIndex !== -1 && backIndex !== -1) {
      return { frontIndex, backIndex };
    }
  }
  return null;
}
