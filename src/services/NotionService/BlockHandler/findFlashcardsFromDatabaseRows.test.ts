import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { setupTests } from '../../../test/configure-jest';

beforeEach(() => setupTests());

interface FakeRow {
  properties: Record<string, unknown>;
}

function titleProp(text: string): unknown {
  return { type: 'title', title: [{ plain_text: text }] };
}

function richTextProp(text: string): unknown {
  return { type: 'rich_text', rich_text: [{ plain_text: text }] };
}

function makeApi(opts: { rows: FakeRow[]; dbName?: string }): NotionAPIWrapper {
  return {
    queryDatabase: jest.fn().mockResolvedValue({ results: opts.rows }),
    getDatabase: jest.fn().mockResolvedValue({ id: 'db-1' }),
    getDatabaseTitle: jest.fn().mockResolvedValue(opts.dbName ?? 'Vocabulary'),
  } as unknown as NotionAPIWrapper;
}

function makeHandler(api: NotionAPIWrapper): BlockHandler {
  const settings = new CardOption({});
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  return new BlockHandler(exporter, api, settings);
}

describe('BlockHandler.findFlashcardsFromDatabaseRows', () => {
  it('emits one note per row using auto-inferred Term/Definition mapping', async () => {
    const api = makeApi({
      rows: [
        {
          properties: {
            Term: titleProp('aller'),
            Definition: richTextProp('to go'),
          },
        },
        {
          properties: {
            Term: titleProp('manger'),
            Definition: richTextProp('to eat'),
          },
        },
        {
          properties: {
            Term: titleProp('dormir'),
            Definition: richTextProp('to sleep'),
          },
        },
      ],
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks).toHaveLength(1);
    expect(decks[0].name).toBe('Vocabulary');
    expect(decks[0].cards.map((c) => [c.name, c.back])).toEqual([
      ['aller', 'to go'],
      ['manger', 'to eat'],
      ['dormir', 'to sleep'],
    ]);
  });

  it.each([
    ['Word', 'Translation'],
    ['Front', 'Back'],
    ['Question', 'Answer'],
    ['Vocabulary', 'Meaning'],
  ])('auto-infers %s / %s', async (frontName, backName) => {
    const api = makeApi({
      rows: [
        {
          properties: {
            [frontName]: titleProp('hello'),
            [backName]: richTextProp('bonjour'),
          },
        },
      ],
    });
    const decks = await makeHandler(api).findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });
    expect(decks[0].cards[0].name).toBe('hello');
    expect(decks[0].cards[0].back).toBe('bonjour');
  });

  it('skips rows missing either front or back text', async () => {
    const api = makeApi({
      rows: [
        {
          properties: {
            Term: titleProp('aller'),
            Definition: richTextProp('to go'),
          },
        },
        {
          properties: {
            Term: titleProp(''),
            Definition: richTextProp('to eat'),
          },
        },
        {
          properties: {
            Term: titleProp('dormir'),
            Definition: richTextProp(''),
          },
        },
        {
          properties: {
            Term: titleProp('parler'),
            Definition: richTextProp('to speak'),
          },
        },
      ],
    });
    const decks = await makeHandler(api).findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });
    expect(decks[0].cards.map((c) => c.name)).toEqual(['aller', 'parler']);
  });

  it('degrades to first/second column and records a guess when no canonical mapping is found', async () => {
    const api = makeApi({
      rows: [
        {
          properties: {
            Notes: titleProp('aller'),
            Tags: richTextProp('to go'),
          },
        },
        {
          properties: {
            Notes: titleProp('manger'),
            Tags: richTextProp('to eat'),
          },
        },
      ],
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks).toHaveLength(1);
    expect(decks[0].cards.map((c) => [c.name, c.back])).toEqual([
      ['aller', 'to go'],
      ['manger', 'to eat'],
    ]);
    expect(bl.guessedColumnMapping).toEqual({
      frontField: 'Notes',
      backField: 'Tags',
    });
  });

  it('does not record a guess when the mapping is unambiguous', async () => {
    const api = makeApi({
      rows: [
        {
          properties: {
            Term: titleProp('aller'),
            Definition: richTextProp('to go'),
          },
        },
      ],
    });
    const bl = makeHandler(api);

    await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(bl.guessedColumnMapping).toBeUndefined();
  });

  it('still fails when the database has only one column to map', async () => {
    const api = makeApi({
      rows: [{ properties: { Notes: titleProp('x') } }],
    });
    const bl = makeHandler(api);

    await expect(
      bl.findFlashcards({
        parentType: 'notion-database',
        topLevelId: 'db-1',
        rules: new ParserRules(),
        decks: [],
        parentName: '',
      })
    ).rejects.toThrow(/Front or back column not found/);
  });

  it('honors explicit frontField/backField when provided, bypassing auto-infer', async () => {
    const api = makeApi({
      rows: [
        {
          properties: {
            Notes: titleProp('aller'),
            Tags: richTextProp('to go'),
          },
        },
      ],
    });
    const decks = await makeHandler(api).findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
      frontField: 'Notes',
      backField: 'Tags',
    });
    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toBe('aller');
    expect(decks[0].cards[0].back).toBe('to go');
  });

  it('rejects explicit fields that do not exist in the database', async () => {
    const api = makeApi({
      rows: [
        { properties: { Term: titleProp('x'), Definition: richTextProp('y') } },
      ],
    });
    await expect(
      makeHandler(api).findFlashcards({
        parentType: 'notion-database',
        topLevelId: 'db-1',
        rules: new ParserRules(),
        decks: [],
        parentName: '',
        frontField: 'Nope',
        backField: 'Also Nope',
      })
    ).rejects.toThrow(/Front or back column not found/);
  });

  it('records resolvedDatabasePath with viaPageLinkSelfHeal=false on the deliberate database-picker entry point', async () => {
    const api = makeApi({
      rows: [
        {
          properties: {
            Term: titleProp('aller'),
            Definition: richTextProp('to go'),
          },
        },
      ],
    });
    const bl = makeHandler(api);

    await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(bl.resolvedDatabasePath).toEqual({ viaPageLinkSelfHeal: false });
  });

  it('records resolvedDatabasePath with viaPageLinkSelfHeal=true when a page link self-heals into the database path', async () => {
    const api = makeApi({
      rows: [
        {
          properties: {
            Term: titleProp('aller'),
            Definition: richTextProp('to go'),
          },
        },
      ],
    });
    const bl = makeHandler(api);
    jest.spyOn(bl, 'findFlashcardsFromPage').mockRejectedValue({
      code: 'validation_error',
      message: 'db-1 is a database, not a page',
    });

    await bl.findFlashcards({
      parentType: 'page',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(bl.resolvedDatabasePath).toEqual({ viaPageLinkSelfHeal: true });
  });

  it('falls back to another column pair when the chosen one is blank on every row', async () => {
    const api = makeApi({
      rows: [
        {
          properties: {
            Status: richTextProp(''),
            Prompt: titleProp('What is an ion?'),
            Response: richTextProp('An atom with a charge.'),
          },
        },
        {
          properties: {
            Status: richTextProp(''),
            Prompt: titleProp('What is a cation?'),
            Response: richTextProp('A positively charged ion.'),
          },
        },
      ],
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks[0].cards.map((c) => [c.name, c.back])).toEqual([
      ['What is an ion?', 'An atom with a charge.'],
      ['What is a cation?', 'A positively charged ion.'],
    ]);
    expect(bl.guessedColumnMapping).toEqual({
      frontField: 'Prompt',
      backField: 'Response',
    });
  });

  it('leaves the deck empty when no column pair yields a card', async () => {
    const api = makeApi({
      rows: [
        {
          properties: {
            Status: richTextProp(''),
            Owner: richTextProp(''),
          },
        },
      ],
    });

    const decks = await makeHandler(api).findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks[0].cards).toHaveLength(0);
  });
});
