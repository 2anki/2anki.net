import { rowsFromBuffer } from './tabularRows';

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
