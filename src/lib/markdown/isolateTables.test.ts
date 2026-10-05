import { isolateTablesFromText } from './isolateTables';

describe('isolateTablesFromText', () => {
  it('inserts a blank line before a table glued to a bullet', () => {
    const input = [
      '- Heading bullet',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');
    expect(isolateTablesFromText(input)).toBe(
      ['- Heading bullet', '', '| A | B |', '| --- | --- |', '| 1 | 2 |'].join(
        '\n'
      )
    );
  });

  it('inserts a blank line before a table glued to a paragraph', () => {
    const input = ['Some text', '| A | B |', '| --- | --- |'].join('\n');
    expect(isolateTablesFromText(input)).toBe(
      ['Some text', '', '| A | B |', '| --- | --- |'].join('\n')
    );
  });

  it('leaves an already blank-separated table untouched', () => {
    const input = ['Some text', '', '| A | B |', '| --- | --- |'].join('\n');
    expect(isolateTablesFromText(input)).toBe(input);
  });

  it('handles alignment markers in the delimiter row', () => {
    const input = ['Text', '| A | B | C |', '| :--- | :---: | ---: |'].join(
      '\n'
    );
    expect(isolateTablesFromText(input)).toBe(
      ['Text', '', '| A | B | C |', '| :--- | :---: | ---: |'].join('\n')
    );
  });

  it('does not treat a horizontal rule as a table delimiter', () => {
    const input = ['Some text', '---'].join('\n');
    expect(isolateTablesFromText(input)).toBe(input);
  });

  it('does not insert when the following line is not a delimiter', () => {
    const input = ['Some text', '| not | a | table |', 'more text'].join('\n');
    expect(isolateTablesFromText(input)).toBe(input);
  });

  it('leaves a document with no tables unchanged', () => {
    const input = '# Title\n\nParagraph with a | pipe in it.\n\n- bullet';
    expect(isolateTablesFromText(input)).toBe(input);
  });
});
