import * as XLSX from 'xlsx';
import { rowsFromBuffer, sheetsFromBuffer } from './tabularRows';

const SHEET_HIDDEN = 1;
const SHEET_VERY_HIDDEN = 2;

describe('rowsFromBuffer with markup at the start of the file', () => {
  it.each([
    [
      'a tag in the first cell',
      'cards.csv',
      '<b>Front</b>,Back\n<i>Q2</i>,A2\n',
      [
        ['<b>Front</b>', 'Back'],
        ['<i>Q2</i>', 'A2'],
      ],
    ],
    [
      'an image in the first cell',
      'cards.csv',
      '<img src="x.png">,The answer\nQ2,A2\n',
      [
        ['<img src="x.png">', 'The answer'],
        ['Q2', 'A2'],
      ],
    ],
    [
      'a tag in a tab-separated file',
      'cards.tsv',
      '<b>Front</b>\tBack\nQ2\tA2\n',
      [
        ['<b>Front</b>', 'Back'],
        ['Q2', 'A2'],
      ],
    ],
    [
      'a byte order mark before the tag',
      'cards.csv',
      '﻿<b>Front</b>,Back\n',
      [['<b>Front</b>', 'Back']],
    ],
  ])('keeps the rows for %s', (_label, name, text, rows) => {
    expect(rowsFromBuffer(Buffer.from(text, 'utf8'), name)).toEqual(rows);
  });

  it.each([
    [
      'a card holding a table in a later row',
      '<b>Q1</b>,back\nQ2,"<table border=1><tr><td>x</td></tr></table>"\nQ3,A3\n',
      [
        ['<b>Q1</b>', 'back'],
        ['Q2', '<table border=1><tr><td>x</td></tr></table>'],
        ['Q3', 'A3'],
      ],
    ],
    [
      'a tag whose name only begins like a table',
      '<tablet>x</tablet>,back\n',
      [['<tablet>x</tablet>', 'back']],
    ],
    [
      'a blank line before the tag',
      '\n<b>Q</b>,A\nQ2,A2\n',
      [
        ['<b>Q</b>', 'A'],
        ['Q2', 'A2'],
      ],
    ],
    ['a div row', '<div>Front</div>,Back\n', [['<div>Front</div>', 'Back']]],
    [
      'text that only looks like a tag',
      '<3 cats,love\n',
      [['<3 cats', 'love']],
    ],
  ])('keeps the rows for %s', (_label, text, rows) => {
    expect(rowsFromBuffer(Buffer.from(text, 'utf8'), 'cards.csv')).toEqual(
      rows
    );
  });

  it.each([
    [
      'an unclosed tag before a tab',
      '<b unclosed\tBack\n',
      ['<b unclosed', 'Back'],
    ],
    ['an unclosed closing tag', '<b>Front</b,Back\n', ['<b>Front</b', 'Back']],
    ['a later tag left open', '<i>x</i> <y,z\n', ['<i>x</i> <y', 'z']],
    ['a heart after a tag', '<b>a</b> <3 c,d\n', ['<b>a</b> <3 c', 'd']],
  ])('keeps the row for %s', (_label, text, row) => {
    expect(rowsFromBuffer(Buffer.from(text, 'utf8'), 'cards.csv')).toEqual([
      row,
    ]);
  });

  it('keeps a comma in a table cell from turning a table into a row', () => {
    const html = '<table><tr><td>Q, x</td><td>A</td></tr></table>';

    expect(rowsFromBuffer(Buffer.from(html, 'utf8'), 'cards.csv')).toEqual([
      ['Q, x', 'A'],
    ]);
  });

  it('leaves html later in a file to the normal reader', () => {
    const csv = 'Front,Back\n<b>Q2</b>,A2\n';

    expect(rowsFromBuffer(Buffer.from(csv, 'utf8'), 'cards.csv')).toEqual([
      ['Front', 'Back'],
      ['<b>Q2</b>', 'A2'],
    ]);
  });

  it.each([
    [
      'an HTML table',
      '<html><body><table><tr><td>Q</td><td>A</td></tr></table></body></html>',
    ],
    ['a bare table', '<table><tr><td>Q</td><td>A</td></tr></table>'],
    [
      'a style block with a comma in a selector',
      '<style>td,th{color:red}</style><table><tr><td>Q</td><td>A</td></tr></table>',
    ],
    [
      'a tag with a comma in an attribute',
      '<div style="font:a,b"><table><tr><td>Q</td><td>A</td></tr></table></div>',
    ],
    [
      'a table after a charset tag',
      '<meta charset="utf-8"><table><tr><td>Q</td><td>A</td></tr></table>',
    ],
    [
      'a table after a style block',
      '<style>td{color:red}</style><table><tr><td>Q</td><td>A</td></tr></table>',
    ],
    [
      'a table after a comment',
      '<!-- export --><table><tr><td>Q</td><td>A</td></tr></table>',
    ],
    [
      'a table inside a div, with no comma on the line',
      '<div><table><tr><td>Q</td><td>A</td></tr></table></div>',
    ],
    [
      'an Excel XML workbook',
      '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="a"><Table><Row><Cell><Data ss:Type="String">Q</Data></Cell><Cell><Data ss:Type="String">A</Data></Cell></Row></Table></Worksheet></Workbook>',
    ],
  ])('still reads %s saved under a text name', (_label, document) => {
    expect(rowsFromBuffer(Buffer.from(document, 'utf8'), 'cards.csv')).toEqual([
      ['Q', 'A'],
    ]);
  });

  it.each([
    ['an XML document', '<?xml version="1.0"?>\n<root><a>1</a></root>\n'],
    ['an HTML page', '<!DOCTYPE html>\n<html>\n<body>hi</body>\n</html>'],
    ['a blank line before an HTML page', '\n<html><body>hi</body></html>'],
    ['a page with only a head', '<head><title>Sign in</title></head>'],
    ['a page with a charset tag', '<meta charset="utf-8"><p>hi</p>'],
    ['a div with no separator', '<div>hello</div>'],
    [
      'a known document tag with a comma in its text',
      '<body>Hello, world</body>',
    ],
    ['an image with a comma in an attribute', '<img alt="a,b" src="x">'],
    ['another XML dialect', '<root><a>1</a></root>'],
  ])('finds no rows in %s saved as a csv', (_label, text) => {
    expect(rowsFromBuffer(Buffer.from(text, 'utf8'), 'cards.csv')).toEqual([]);
  });
});

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
