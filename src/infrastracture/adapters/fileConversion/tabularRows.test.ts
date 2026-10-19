import * as XLSX from 'xlsx';
import { rowsFromBuffer, sheetsFromBuffer } from './tabularRows';

const SHEET_HIDDEN = 1;
const SHEET_VERY_HIDDEN = 2;

describe('rowsFromBuffer', () => {
  it('splits a .tsv on tabs even when the cells hold commas', () => {
    const tsv = 'What is osmosis, really?\tWater, crossing a membrane\n';
    expect(rowsFromBuffer(Buffer.from(tsv, 'utf8'), 'cards.tsv')).toEqual([
      ['What is osmosis, really?', 'Water, crossing a membrane'],
    ]);
  });

  it.each([
    [
      'cards.tsv',
      '\ufeffWhat is osmosis?\tWater crossing a membrane\n',
      [['What is osmosis?', 'Water crossing a membrane']],
    ],
    [
      'cards.csv',
      '\ufefffront,back\nQ,A\n',
      [
        ['front', 'back'],
        ['Q', 'A'],
      ],
    ],
  ])('drops a UTF-8 byte order mark in %s', (name, text, rows) => {
    expect(rowsFromBuffer(Buffer.from(text, 'utf8'), name)).toEqual(rows);
  });

  it('keeps the guessed separator for a .tsv whose first line has no tab', () => {
    expect(
      rowsFromBuffer(Buffer.from('front,back\nQ,A\n', 'utf8'), 'cards.tsv')
    ).toEqual([
      ['front', 'back'],
      ['Q', 'A'],
    ]);
  });

  it('reads Windows line endings and quoted tab cells', () => {
    const tsv =
      '"What is, osmosis?"\t"Water ""crossing"" a membrane"\r\na\tb\r\n';
    expect(rowsFromBuffer(Buffer.from(tsv, 'utf8'), 'cards.tsv')).toEqual([
      ['What is, osmosis?', 'Water "crossing" a membrane'],
      ['a', 'b'],
    ]);
  });

  it('still guesses the separator for a .csv', () => {
    expect(rowsFromBuffer(Buffer.from('a;b\nc;d\n', 'utf8'), 'x.csv')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

function buildWorkbook(sheets: Record<string, unknown[][]>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

describe('sheetsFromBuffer', () => {
  it('returns the rows of every sheet keyed by its name', () => {
    const buffer = buildWorkbook({
      Chapter1: [['hola', 'hello']],
      Chapter2: [['adios', 'goodbye']],
    });
    expect(sheetsFromBuffer(buffer, 'vocab.xlsx')).toEqual([
      { name: 'Chapter1', rows: [['hola', 'hello']] },
      { name: 'Chapter2', rows: [['adios', 'goodbye']] },
    ]);
  });

  it('reads a single-sheet workbook as one entry', () => {
    const buffer = buildWorkbook({ Sheet1: [['a', 'b']] });
    expect(sheetsFromBuffer(buffer, 'x.xlsx')).toEqual([
      { name: 'Sheet1', rows: [['a', 'b']] },
    ]);
  });

  it('skips hidden and very hidden sheets', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['hola', 'hello']]),
      'Cards'
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['lookup', 'value']]),
      'Helper'
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['secret', 'value']]),
      'Config'
    );
    XLSX.utils.book_set_sheet_visibility(workbook, 'Helper', SHEET_HIDDEN);
    XLSX.utils.book_set_sheet_visibility(workbook, 'Config', SHEET_VERY_HIDDEN);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    expect(sheetsFromBuffer(buffer, 'vocab.xlsx')).toEqual([
      { name: 'Cards', rows: [['hola', 'hello']] },
    ]);
  });

  it('keeps the first visible sheet when an earlier sheet is hidden', () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['lookup', 'value']]),
      'Helper'
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['hola', 'hello']]),
      'Cards'
    );
    XLSX.utils.book_set_sheet_visibility(workbook, 'Helper', SHEET_HIDDEN);
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    expect(sheetsFromBuffer(buffer, 'vocab.xlsx')).toEqual([
      { name: 'Cards', rows: [['hola', 'hello']] },
    ]);
  });
});
