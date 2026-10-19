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
function readWorkbook(buffer: Buffer, fileName: string): XLSX.WorkBook {
  const bytes = buffer.subarray(0, 3).equals(UTF8_BOM)
    ? buffer.subarray(3)
    : buffer;
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

export function rowsFromBuffer(buffer: Buffer, fileName = ''): TabularRow[] {
  const workbook = readWorkbook(buffer, fileName);
  return sheetRows(workbook.Sheets[workbook.SheetNames[0]]);
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
