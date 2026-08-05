import FallbackParser from './FallbackParser';

describe('FallbackParser.htmlToTextWithNewlines', () => {
  it('returns empty array and logs warning when html is undefined', () => {
    const parser = new FallbackParser([]);
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    const result = parser.htmlToTextWithNewlines(undefined as any);
    expect(result).toEqual([]);
    expect(spy).toHaveBeenCalledWith(
      '[FallbackParser] htmlToTextWithNewlines called with invalid html:',
      undefined
    );
    spy.mockRestore();
  });

  it('returns empty array and logs warning when html is null', () => {
    const parser = new FallbackParser([]);
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    const result = parser.htmlToTextWithNewlines(null as any);
    expect(result).toEqual([]);
    expect(spy).toHaveBeenCalledWith(
      '[FallbackParser] htmlToTextWithNewlines called with invalid html:',
      null
    );
    spy.mockRestore();
  });

  it('returns empty array and logs warning when html is empty string', () => {
    const parser = new FallbackParser([]);
    const spy = jest.spyOn(console, 'warn').mockImplementation();
    const result = parser.htmlToTextWithNewlines('');
    expect(result).toEqual([]);
    expect(spy).toHaveBeenCalledWith(
      '[FallbackParser] htmlToTextWithNewlines called with invalid html:',
      ''
    );
    spy.mockRestore();
  });

  it('parses simple ul/li html correctly', () => {
    const parser = new FallbackParser([]);
    const html = '<ul><li>Item 1</li><li>Item 2</li></ul>';
    const result = parser.htmlToTextWithNewlines(html);
    expect(result).toEqual(['• Item 1\n• Item 2\n']);
  });
});

describe('FallbackParser tab-separated text', () => {
  it('creates cards from tab-separated lines in a .txt file', () => {
    const tabContent = 'What is the capital of France?\tParis\nWhat is 2+2?\t4';
    const parser = new FallbackParser([
      { name: 'my_deck.txt', contents: Buffer.from(tabContent) },
    ]);
    const settings = {} as any;
    const decks = parser.run(settings);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(2);
    expect(decks[0].cards[0].name).toBe('What is the capital of France?');
    expect(decks[0].cards[0].back).toBe('Paris');
    expect(decks[0].cards[1].name).toBe('What is 2+2?');
    expect(decks[0].cards[1].back).toBe('4');
  });

  it('skips lines without tabs in tab-separated text', () => {
    const tabContent = 'What is 1+1?\t2\nThis line has no tab\nWhat is 3+3?\t6';
    const parser = new FallbackParser([
      { name: 'deck.txt', contents: Buffer.from(tabContent) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(2);
  });

  it('prefers tab-separated parsing over bullet list parsing for tab content', () => {
    const tabContent = 'Front1\tBack1\nFront2\tBack2';
    const parser = new FallbackParser([
      { name: 'study.txt', contents: Buffer.from(tabContent) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards[0].name).toBe('Front1');
    expect(decks[0].cards[0].back).toBe('Back1');
  });
});

describe('FallbackParser CSV column mapping', () => {
  it('maps front and back by column name when the header order is reversed', () => {
    const csv = 'back,front\nHello,Bonjour';
    const parser = new FallbackParser([
      { name: 'vocab.csv', contents: Buffer.from(csv) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toBe('Bonjour');
    expect(decks[0].cards[0].back).toBe('Hello');
  });

  it('detects a question/answer header and maps by name', () => {
    const csv = 'question,answer\nWhat is 2+2?,4';
    const parser = new FallbackParser([
      { name: 'math.csv', contents: Buffer.from(csv) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards[0].name).toBe('What is 2+2?');
    expect(decks[0].cards[0].back).toBe('4');
  });

  it('keeps the first row as a card when there is no recognizable header', () => {
    const csv = 'Dog,Animal\nCat,Feline';
    const parser = new FallbackParser([
      { name: 'headerless.csv', contents: Buffer.from(csv) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(2);
    expect(decks[0].cards[0].name).toBe('Dog');
    expect(decks[0].cards[0].back).toBe('Animal');
    expect(decks[0].cards[1].name).toBe('Cat');
    expect(decks[0].cards[1].back).toBe('Feline');
  });

  it('maps column 0 to front and column 1 to back in the positional fallback', () => {
    const csv = 'H2O,Water\nNaCl,Salt';
    const parser = new FallbackParser([
      { name: 'chem.csv', contents: Buffer.from(csv) },
    ]);
    const decks = parser.run({} as any);
    expect(decks[0].cards[0].name).toBe('H2O');
    expect(decks[0].cards[0].back).toBe('Water');
    expect(decks[0].cards[1].name).toBe('NaCl');
    expect(decks[0].cards[1].back).toBe('Salt');
  });

  it('keeps commas inside a quoted field intact', () => {
    const csv = 'front,back\n"Paris, France",Capital of France';
    const parser = new FallbackParser([
      { name: 'geo.csv', contents: Buffer.from(csv) },
    ]);
    const decks = parser.run({} as any);
    expect(decks[0].cards[0].name).toBe('Paris, France');
    expect(decks[0].cards[0].back).toBe('Capital of France');
  });

  it('drops a generic Term/Definition header row', () => {
    const csv = 'Term,Definition\nDog,Animal';
    const parser = new FallbackParser([
      { name: 'quizlet.csv', contents: Buffer.from(csv) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toBe('Dog');
    expect(decks[0].cards[0].back).toBe('Animal');
  });
});

describe('FallbackParser CSV byte decoding', () => {
  it('decodes a BOM-less UTF-8 CSV as UTF-8, not Windows-1252', () => {
    const csv = 'café,drink\n日本語,Japanese';
    const parser = new FallbackParser([
      { name: 'unicode.csv', contents: Buffer.from(csv, 'utf8') },
    ]);
    const decks = parser.run({} as any);
    expect(decks[0].cards[0].name).toBe('café');
    expect(decks[0].cards[0].back).toBe('drink');
    expect(decks[0].cards[1].name).toBe('日本語');
    expect(decks[0].cards[1].back).toBe('Japanese');
  });

  it('keeps numeric, leading-zero, and date cells as their literal text', () => {
    const csv = '007,agent\n1/2/2026,due date';
    const parser = new FallbackParser([
      { name: 'codes.csv', contents: Buffer.from(csv) },
    ]);
    const decks = parser.run({} as any);
    expect(decks[0].cards[0].name).toBe('007');
    expect(decks[0].cards[0].back).toBe('agent');
    expect(decks[0].cards[1].name).toBe('1/2/2026');
    expect(decks[0].cards[1].back).toBe('due date');
  });
});

describe('FallbackParser nested lists', () => {
  it('does not double-count items in a nested list', () => {
    const parser = new FallbackParser([]);
    const html = `<ul><li>Outer<ul><li>Inner</li></ul></li></ul>`;
    const result = parser.htmlToTextWithNewlines(html);

    const innerOccurrences = result.join('\n').split('Inner').length - 1;
    expect(innerOccurrences).toBe(1);
  });
});

describe('FallbackParser unstructured text (no tabs, no bullets)', () => {
  it('creates cards from a .txt of "question - answer" pairs, one per line', () => {
    const content = 'What is the capital of France? - Paris\nWhat is 2+2? - 4';
    const parser = new FallbackParser([
      { name: 'study.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(2);
    expect(decks[0].cards[0].name).toBe('What is the capital of France?');
    expect(decks[0].cards[0].back).toBe('Paris');
    expect(decks[0].cards[1].name).toBe('What is 2+2?');
    expect(decks[0].cards[1].back).toBe('4');
  });

  it('creates cards from "question = answer" pairs', () => {
    const content = 'H2O = Water\nNaCl = Salt';
    const parser = new FallbackParser([
      { name: 'chem.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(2);
    expect(decks[0].cards[0].name).toBe('H2O');
    expect(decks[0].cards[0].back).toBe('Water');
  });

  it('produces an empty deck for a prose .txt with no card shape', () => {
    const content =
      'The mitochondria is the powerhouse of the cell.\nIt produces ATP through respiration.\nThis is just prose with no separators.';
    const parser = new FallbackParser([
      { name: 'notes.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(0);
  });

  it('keeps only the structured card when prose surrounds one pair', () => {
    const content =
      'Some introductory prose with no separator.\nWhat is the powerhouse of the cell? - Mitochondria\nMore trailing prose here.';
    const parser = new FallbackParser([
      { name: 'mixed.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toBe('What is the powerhouse of the cell?');
    expect(decks[0].cards[0].back).toBe('Mitochondria');
  });

  it('produces an empty deck for a prose .md export with no bullets', () => {
    const content =
      '# My Notes\n\nThis is a paragraph of prose exported from Notion.\nIt has no toggles and no bullet points at all.';
    const parser = new FallbackParser([
      { name: 'My Notes.md', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(0);
  });
});

describe('FallbackParser deck naming', () => {
  const csv = 'front,back\nBonjour,Hello';

  it('strips the extension from a CSV deck name, like its sibling branches', () => {
    const parser = new FallbackParser([
      { name: 'JLPT N5.csv', contents: Buffer.from(csv) },
    ]);
    const decks = parser.run({} as any);
    expect(decks[0].name).toBe('JLPT N5');
  });

  it('uses an explicit deckName over the filename for CSV', () => {
    const parser = new FallbackParser([
      { name: 'JLPT N5.csv', contents: Buffer.from(csv) },
    ]);
    const decks = parser.run({ deckName: 'Japanese vocab' } as any);
    expect(decks[0].name).toBe('Japanese vocab');
  });

  it('uses an explicit deckName over the filename for plain text', () => {
    const parser = new FallbackParser([
      {
        name: 'notes.txt',
        contents: Buffer.from('Bonjour\tHello\nMerci\tThanks'),
      },
    ]);
    const decks = parser.run({ deckName: 'Japanese vocab' } as any);
    expect(decks[0].name).toBe('Japanese vocab');
  });

  it('falls back to the filename when no deckName is given', () => {
    const parser = new FallbackParser([
      { name: 'vocab.csv', contents: Buffer.from(csv) },
    ]);
    const decks = parser.run({ deckName: '' } as any);
    expect(decks[0].name).toBe('vocab');
  });
});
