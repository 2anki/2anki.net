import { rowsFromBuffer } from './tabularRows';

describe('rowsFromBuffer', () => {
  it('splits a .tsv on tabs even when the cells hold commas', () => {
    const tsv = 'What is osmosis, really?\tWater, crossing a membrane\n';
    expect(rowsFromBuffer(Buffer.from(tsv, 'utf8'), 'cards.tsv')).toEqual([
      ['What is osmosis, really?', 'Water, crossing a membrane'],
    ]);
  });

  it('drops a UTF-8 byte order mark instead of leaving it in the first cell', () => {
    const tsv = '\ufeffWhat is osmosis?\tWater crossing a membrane\n';
    expect(rowsFromBuffer(Buffer.from(tsv, 'utf8'), 'cards.tsv')).toEqual([
      ['What is osmosis?', 'Water crossing a membrane'],
    ]);
    const csv = '\ufefffront,back\nQ,A\n';
    expect(rowsFromBuffer(Buffer.from(csv, 'utf8'), 'cards.csv')).toEqual([
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
