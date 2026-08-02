import * as XLSX from 'xlsx';

export type TabularRow = unknown[];

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

export function rowsFromBuffer(buffer: Buffer): TabularRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', codepage: 65001 });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
  }) as TabularRow[];
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
