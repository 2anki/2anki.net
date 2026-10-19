import { vi } from 'vitest';
import FallbackParser from './FallbackParser';

describe('FallbackParser.htmlToTextWithNewlines', () => {
  it('returns empty array and logs warning when html is undefined', () => {
    const parser = new FallbackParser([]);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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

  it('continues the previous card when a tab-separated line has no tab', () => {
    const tabContent = 'What is 1+1?\t2\nThis line has no tab\nWhat is 3+3?\t6';
    const parser = new FallbackParser([
      { name: 'deck.txt', contents: Buffer.from(tabContent) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(2);
    expect(decks[0].cards[0].name).toBe('What is 1+1?');
    expect(decks[0].cards[0].back).toBe('2\nThis line has no tab');
    expect(decks[0].cards[1].name).toBe('What is 3+3?');
    expect(decks[0].cards[1].back).toBe('6');
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

describe('FallbackParser comma-separated text (Quizlet comma export)', () => {
  it('creates one card per line from a comma-separated .txt export', () => {
    const content =
      'mitochondria,powerhouse of the cell\nosmosis,diffusion of water across a membrane\nATP,energy currency of the cell';
    const parser = new FallbackParser([
      { name: 'quizlet_export.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(3);
    expect(decks[0].cards[0].name).toBe('mitochondria');
    expect(decks[0].cards[0].back).toBe('powerhouse of the cell');
    expect(decks[0].cards[2].name).toBe('ATP');
    expect(decks[0].cards[2].back).toBe('energy currency of the cell');
  });

  it('splits on the first comma when a definition itself contains commas', () => {
    const content =
      'CNS,brain and spinal cord\nPNS,nerves outside the CNS\nneuron,nerve cell\nsynapse,junction between neurons\nglia,support cells\naxon,long projection\ndendrite,branched projection\nsoma,cell body\nmyelin,insulating sheath\nmeninges,dura, arachnoid, and pia mater';
    const parser = new FallbackParser([
      { name: 'anatomy.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(10);
    expect(decks[0].cards[9].name).toBe('meninges');
    expect(decks[0].cards[9].back).toBe('dura, arachnoid, and pia mater');
  });

  it('leaves " - " pair files to pair parsing even when lines contain commas', () => {
    const content =
      'What is DNA? - deoxyribonucleic acid, the genetic code\nWhat is RNA? - ribonucleic acid, the messenger\nWhat is a gene? - a unit of heredity, made of DNA';
    const parser = new FallbackParser([
      { name: 'bio.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(3);
    expect(decks[0].cards[0].name).toBe('What is DNA?');
    expect(decks[0].cards[0].back).toBe(
      'deoxyribonucleic acid, the genetic code'
    );
  });

  it('keeps prose with varying comma counts an empty deck', () => {
    const content =
      'The cell membrane regulates transport, signaling, and adhesion.\nRibosomes synthesize proteins.\nThe nucleus, dense and central, stores DNA.\nEnzymes lower activation energy.';
    const parser = new FallbackParser([
      { name: 'lecture_notes.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(0);
  });

  it('needs at least three lines before treating commas as separators', () => {
    const content = 'First point, made in passing.\nSecond point, also brief.';
    const parser = new FallbackParser([
      { name: 'two_lines.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(0);
  });
});

describe('FallbackParser Quizlet multi-line and custom separators', () => {
  it('attaches a definition that wraps onto the next line to its term', () => {
    const content =
      'photosynthesis\tprocess plants use to make food\nit happens in the chloroplasts\nrespiration\tbreaks down glucose for energy\nosmosis\tdiffusion of water across a membrane';
    const parser = new FallbackParser([
      { name: 'biology.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(3);
    expect(decks[0].cards[0].name).toBe('photosynthesis');
    expect(decks[0].cards[0].back).toBe(
      'process plants use to make food\nit happens in the chloroplasts'
    );
    expect(decks[0].cards[1].name).toBe('respiration');
    expect(decks[0].cards[2].name).toBe('osmosis');
  });

  it('keeps a bulleted definition on its term instead of fanning out cards', () => {
    const content =
      'mitosis\tcell division that yields two identical cells:\n- prophase\n- metaphase\nmeiosis\tproduces four gametes\nosmosis\twater diffusion\ndiffusion\tparticles spreading out';
    const parser = new FallbackParser([
      { name: 'cell.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(4);
    expect(decks[0].cards[0].name).toBe('mitosis');
    expect(decks[0].cards[0].back).toBe(
      'cell division that yields two identical cells:\n- prophase\n- metaphase'
    );
    expect(decks[0].cards.map((card) => card.name)).not.toContain('- prophase');
  });

  it('splits semicolon-separated rows with a tab between term and definition', () => {
    const content =
      'mitochondria\tpowerhouse of the cell;osmosis\tdiffusion of water;ATP\tenergy currency of the cell;ribosome\tmakes proteins';
    const parser = new FallbackParser([
      { name: 'quizlet_semicolon.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(4);
    expect(decks[0].cards[0].name).toBe('mitochondria');
    expect(decks[0].cards[0].back).toBe('powerhouse of the cell');
    expect(decks[0].cards[3].name).toBe('ribosome');
    expect(decks[0].cards[3].back).toBe('makes proteins');
  });

  it('splits semicolon-separated rows with a comma between term and definition', () => {
    const content =
      'mitochondria,powerhouse of the cell;osmosis,diffusion of water;ATP,energy currency;ribosome,makes proteins';
    const parser = new FallbackParser([
      { name: 'quizlet_semicolon_comma.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(4);
    expect(decks[0].cards[0].name).toBe('mitochondria');
    expect(decks[0].cards[0].back).toBe('powerhouse of the cell');
    expect(decks[0].cards[2].name).toBe('ATP');
  });

  it('keeps a tab file whose definitions contain semicolons and commas as tab cards', () => {
    const content =
      'ir\tto go, really; and so forth\nver\tto see, truly; and so on\ncomer\tto eat, indeed; and such';
    const parser = new FallbackParser([
      { name: 'verbs.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(3);
    expect(decks[0].cards[0].name).toBe('ir');
    expect(decks[0].cards[0].back).toBe('to go, really; and so forth');
    expect(decks[0].cards[2].name).toBe('comer');
  });

  it('drops a markdown heading sitting between tab rows', () => {
    const content =
      'mitochondria\tpowerhouse of the cell\n# Organelles\nosmosis\twater diffusion\nnucleus\tstores DNA';
    const parser = new FallbackParser([
      { name: 'organelles.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(3);
    expect(decks[0].cards[0].name).toBe('mitochondria');
    expect(decks[0].cards[0].back).toBe('powerhouse of the cell');
    expect(decks[0].cards.map((card) => card.name)).not.toContain(
      '# Organelles'
    );
  });
});

describe('FallbackParser conservative rejection of prose and CSV shapes', () => {
  it('keeps prose where every line has its own commas an empty deck', () => {
    const content =
      'The cell membrane regulates transport, signaling, and adhesion.\nThe nucleus, dense and central, stores the DNA.\nMitochondria, small and numerous, produce the ATP.';
    const parser = new FallbackParser([
      { name: 'notes.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(0);
  });

  it('keeps a single prose paragraph with semicolons an empty deck', () => {
    const content =
      'The mitochondria produces energy, called ATP; the nucleus stores material, called DNA; ribosomes assemble the proteins, from amino acids';
    const parser = new FallbackParser([
      { name: 'paragraph.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(0);
  });

  it('keeps a CSV-shaped .txt with quoted fields an empty deck', () => {
    const content =
      '"Paris, France","Capital of France"\n"Berlin, Germany","Capital of Germany"\n"Tokyo, Japan","Capital of Japan"';
    const parser = new FallbackParser([
      { name: 'capitals.txt', contents: Buffer.from(content) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(0);
  });
});

describe('FallbackParser .tsv files', () => {
  it('keeps commas inside the cells of a tab-separated file', () => {
    const tsv =
      'What is osmosis, really?\tWater, crossing a membrane\nWhat is diffusion?\tParticles spreading\n';
    const parser = new FallbackParser([
      { name: 'cards.tsv', contents: Buffer.from(tsv) },
    ]);
    const decks = parser.run({} as any);
    expect(decks[0].cards.map((card) => [card.name, card.back])).toEqual([
      ['What is osmosis, really?', 'Water, crossing a membrane'],
      ['What is diffusion?', 'Particles spreading'],
    ]);
  });

  it('maps a front and back header in a .tsv and drops the byte order mark', () => {
    const tsv = '\ufeffback\tfront\nHello\tBonjour\n';
    const parser = new FallbackParser([
      { name: 'vocab.tsv', contents: Buffer.from(tsv) },
    ]);
    const decks = parser.run({} as any);
    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toBe('Bonjour');
    expect(decks[0].cards[0].back).toBe('Hello');
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

describe('FallbackParser TSV uploads', () => {
  it('reads a tab-separated .tsv file as cards', () => {
    const tsv = 'front\tback\nHola\tHello\nAdiós\tGoodbye';
    const parser = new FallbackParser([
      { name: 'vocab.tsv', contents: Buffer.from(tsv) },
    ]);
    const decks = parser.run({} as any);
    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(2);
    expect(decks[0].cards[0].name).toBe('Hola');
    expect(decks[0].cards[0].back).toBe('Hello');
    expect(decks[0].cards[1].name).toBe('Adiós');
    expect(decks[0].cards[1].back).toBe('Goodbye');
  });
});
