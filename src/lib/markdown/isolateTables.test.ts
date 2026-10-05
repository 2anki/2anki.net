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

  it('does not insert a blank line inside a ``` fenced code block', () => {
    const input = ['```', 'x = 1', '| A | B |', '| --- | --- |', '```'].join(
      '\n'
    );
    expect(isolateTablesFromText(input)).toBe(input);
  });

  it('does not insert a blank line inside a ~~~ fenced code block', () => {
    const input = ['~~~', '| A | B |', '| --- | --- |', '~~~'].join('\n');
    expect(isolateTablesFromText(input)).toBe(input);
  });

  it('does not treat a different fence marker as a close', () => {
    const input = ['```', '~~~', '| A | B |', '| --- | --- |', '```'].join(
      '\n'
    );
    expect(isolateTablesFromText(input)).toBe(input);
  });

  it('does not insert before a table indented inside an indented code block', () => {
    const input = ['    | A | B |', '    | --- | --- |'].join('\n');
    expect(isolateTablesFromText(input)).toBe(input);
  });

  it('does not insert before a table indented under a list item', () => {
    const input = [
      '- bullet',
      '  | A | B |',
      '  | --- | --- |',
      '  | 1 | 2 |',
    ].join('\n');
    expect(isolateTablesFromText(input)).toBe(input);
  });

  it('stays linear on a long whitespace line (ReDoS guard)', () => {
    const input = 'a\n' + ' '.repeat(200000) + 'x';
    const start = performance.now();
    const result = isolateTablesFromText(input);
    const elapsed = performance.now() - start;
    expect(result).toBe(input);
    expect(elapsed).toBeLessThan(1000);
  });

  it('treats a shorter inner fence as content, isolating only after the real close (CommonMark length rule)', () => {
    const input = [
      '````',
      '```',
      'x',
      '````',
      '- item',
      '| A | B |',
      '| --- | --- |',
    ].join('\n');
    expect(isolateTablesFromText(input)).toBe(
      [
        '````',
        '```',
        'x',
        '````',
        '- item',
        '',
        '| A | B |',
        '| --- | --- |',
      ].join('\n')
    );
  });

  it('treats a fence line with an info string as content, not a close', () => {
    const input = [
      '```',
      '```js',
      'x = 1',
      '```',
      '- item',
      '| A | B |',
      '| --- | --- |',
    ].join('\n');
    expect(isolateTablesFromText(input)).toBe(
      [
        '```',
        '```js',
        'x = 1',
        '```',
        '- item',
        '',
        '| A | B |',
        '| --- | --- |',
      ].join('\n')
    );
  });

  it('does not open a fence on a line that is inline code, not a fence', () => {
    const input = [
      '```x``` here',
      '',
      '- item',
      '| A | B |',
      '| --- | --- |',
    ].join('\n');
    expect(isolateTablesFromText(input)).toBe(
      ['```x``` here', '', '- item', '', '| A | B |', '| --- | --- |'].join(
        '\n'
      )
    );
  });
});
