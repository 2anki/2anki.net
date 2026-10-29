import { vi } from 'vitest';
import { APIErrorCode, APIResponseError } from '@notionhq/client';
import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { NotionDatabaseColumnsError } from '../helpers/NotionDatabaseColumnsError';
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

function multiSelectProp(...names: string[]): unknown {
  return {
    type: 'multi_select',
    multi_select: names.map((name) => ({ name })),
  };
}

function makeApi(opts: { rows: FakeRow[]; dbName?: string }): NotionAPIWrapper {
  return {
    notionRequestCount: 0,
    captureForbiddenBlocks: vi.fn(() => new Set<string>()),
    restoreForbiddenBlocks: vi.fn(),
    queryDatabase: vi.fn().mockResolvedValue({ results: opts.rows }),
    getDatabase: vi.fn().mockResolvedValue({ id: 'db-1' }),
    getDatabaseTitle: vi.fn().mockResolvedValue(opts.dbName ?? 'Vocabulary'),
  } as unknown as NotionAPIWrapper;
}

interface IdentifiedRow extends FakeRow {
  id: string;
}

function makeAPIResponseError(code: string): APIResponseError {
  const err = Object.create(APIResponseError.prototype) as APIResponseError;
  Object.assign(err, { name: 'APIResponseError', message: code, code });
  return err;
}

function richText(content: string) {
  return {
    type: 'text' as const,
    text: { content, link: null },
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: 'default' as const,
    },
    plain_text: content,
    href: null,
  };
}

function toggleBlock(id: string, front: string) {
  return {
    object: 'block',
    id,
    parent: { type: 'page_id', page_id: 'row' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: true,
    archived: false,
    in_trash: false,
    type: 'toggle',
    toggle: {
      rich_text: [richText(front)],
      color: 'default',
    },
  };
}

function paragraphBlock(id: string, text: string) {
  return {
    object: 'block',
    id,
    parent: { type: 'block_id', block_id: 'parent' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'paragraph',
    paragraph: {
      rich_text: [richText(text)],
      color: 'default',
    },
  };
}

function makeRowPageApi(opts: {
  rows: IdentifiedRow[];
  dbName?: string;
  blocksByPage: Record<string, unknown[]>;
  titlesByPage?: Record<string, string>;
}): NotionAPIWrapper {
  // Mirror NotionAPIWrapper's API-layer request counter: every fetch the walk
  // makes bumps it, so the fetch-budget check behaves as it does in production.
  let notionRequestCount = 0;
  const api = {
    get notionRequestCount() {
      return notionRequestCount;
    },
    captureForbiddenBlocks: vi.fn(() => new Set<string>()),
    restoreForbiddenBlocks: vi.fn(),
    queryDatabase: vi.fn(async () => {
      notionRequestCount += 1;
      return { results: opts.rows };
    }),
    getDatabase: vi.fn(async () => {
      notionRequestCount += 1;
      return { id: 'db-1' };
    }),
    getDatabaseTitle: vi.fn().mockResolvedValue(opts.dbName ?? 'Lectures'),
    getPage: vi.fn(async (id: string) => {
      notionRequestCount += 1;
      return { id, object: 'page', created_time: '', last_edited_time: '' };
    }),
    getPageTitle: vi.fn(
      async (page: { id: string }) => opts.titlesByPage?.[page.id] ?? 'Untitled'
    ),
    getTopLevelTags: vi.fn(async () => {
      notionRequestCount += 1;
      return [];
    }),
    getBlocks: vi.fn(async ({ id }: { id: string }) => {
      notionRequestCount += 1;
      return {
        object: 'list',
        results: opts.blocksByPage[id] ?? [],
        next_cursor: null,
        has_more: false,
        type: 'block',
        block: {},
      };
    }),
  };
  return api as unknown as NotionAPIWrapper;
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

  it('still fails with the column error when the single column and its row pages are both empty of cards', async () => {
    const api = makeRowPageApi({
      rows: [{ id: 'row-1', properties: { Notes: titleProp('x') } }],
      blocksByPage: {
        'row-1': [paragraphBlock('p-1', 'just prose, nothing card-shaped')],
      },
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
    ).rejects.toThrow(
      'This database has only one column, "Notes". Add a text column for the back and fill it in, or put the card content in toggles inside each row\'s page, then convert again.'
    );
  });

  it('walks row pages into sub-decks when a Name-only database has toggles in its rows', async () => {
    const api = makeRowPageApi({
      dbName: 'Lectures',
      rows: [
        { id: 'row-1', properties: { Name: titleProp('Lecture 1') } },
        { id: 'row-2', properties: { Name: titleProp('Lecture 2') } },
      ],
      titlesByPage: { 'row-1': 'Lecture 1', 'row-2': 'Lecture 2' },
      blocksByPage: {
        'row-1': [toggleBlock('t-1', 'What is a neuron?')],
        'row-2': [toggleBlock('t-2', 'What is a synapse?')],
        't-1': [paragraphBlock('p-1', 'A nerve cell.')],
        't-2': [paragraphBlock('p-2', 'A junction between neurons.')],
      },
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.map((d) => d.name)).toEqual([
      'Lectures::Lecture 1',
      'Lectures::Lecture 2',
    ]);
    expect(decks[0].cards.map((c) => c.name)).toEqual(['What is a neuron?']);
    expect(decks[0].cards[0].back).toContain('A nerve cell.');
    expect(decks[1].cards.map((c) => c.name)).toEqual(['What is a synapse?']);
    expect(decks[1].cards[0].back).toContain('A junction between neurons.');
    expect(bl.resolvedDatabasePath).toEqual({
      viaPageLinkSelfHeal: false,
      rowPageWalk: true,
      rowPagesSkipped: 0,
      rowPagesErrored: 0,
    });
  });

  it('leaves out a row-page toggle whose answer is only an empty line', async () => {
    const api = makeRowPageApi({
      dbName: 'Lectures',
      rows: [{ id: 'row-1', properties: { Name: titleProp('Lecture 1') } }],
      titlesByPage: { 'row-1': 'Lecture 1' },
      blocksByPage: {
        'row-1': [
          toggleBlock('t-1', 'What is a neuron?'),
          toggleBlock('t-2', 'Left blank'),
        ],
        't-1': [paragraphBlock('p-1', 'A nerve cell.')],
        't-2': [paragraphBlock('p-2', '')],
      },
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.flatMap((d) => d.cards.map((c) => c.name))).toEqual([
      'What is a neuron?',
    ]);
    expect(bl.emptyBackCount).toBe(1);
  });

  it('says the answers are missing when every row-page toggle is blank', async () => {
    const api = makeRowPageApi({
      dbName: 'Lectures',
      rows: [
        {
          id: 'row-1',
          properties: {
            Name: titleProp('Lecture 1'),
            Tags: multiSelectProp('biology'),
          },
        },
      ],
      titlesByPage: { 'row-1': 'Lecture 1' },
      blocksByPage: {
        'row-1': [toggleBlock('t-1', 'Left blank')],
        't-1': [paragraphBlock('p-1', '')],
      },
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.flatMap((d) => d.cards)).toEqual([]);
    expect(bl.emptyDeckReason()).toBe('empty_answers');
  });

  it('ends a Name-only database whose row-page toggles are all blank with the empty-answers reason, not the column error', async () => {
    const api = makeRowPageApi({
      dbName: 'Lectures',
      rows: [{ id: 'row-1', properties: { Name: titleProp('Lecture 1') } }],
      titlesByPage: { 'row-1': 'Lecture 1' },
      blocksByPage: {
        'row-1': [toggleBlock('t-1', 'Left blank')],
        't-1': [paragraphBlock('p-1', '')],
      },
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.flatMap((d) => d.cards)).toEqual([]);
    expect(bl.emptyDeckReason()).toBe('empty_answers');
  });

  it('never reads a database whose row pages are empty as an empty page', async () => {
    const api = makeRowPageApi({
      rows: [{ id: 'row-1', properties: { Notes: titleProp('x') } }],
      blocksByPage: { 'row-1': [] },
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
    ).rejects.toBeInstanceOf(NotionDatabaseColumnsError);
    expect(bl.emptyDeckReason()).toBe('no_toggles');
  });

  it('neither offers nor builds the paragraphs rule on a row page of prose', async () => {
    const api = makeRowPageApi({
      dbName: 'Lectures',
      rows: [
        { id: 'row-1', properties: { Name: titleProp('Lecture 1') } },
        { id: 'row-2', properties: { Name: titleProp('Lecture 2') } },
      ],
      titlesByPage: { 'row-1': 'Lecture 1', 'row-2': 'Lecture 2' },
      blocksByPage: {
        'row-1': [toggleBlock('t-1', 'What is a neuron?')],
        't-1': [paragraphBlock('p-1', 'A nerve cell.')],
        'row-2': [
          paragraphBlock('p-2', 'Osmosis moves water across a membrane.'),
          paragraphBlock('p-3', 'Diffusion spreads particles out over time.'),
          paragraphBlock('p-4', 'Active transport spends energy to move ions.'),
        ],
      },
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
      rescueRule: 'paragraphs',
    });

    expect(decks.flatMap((d) => d.cards).map((c) => c.name)).toEqual([
      'What is a neuron?',
    ]);
    expect(bl.rescueCandidates).toEqual([]);
  });

  it('keeps row pages in database order and skips rows whose page has no cards', async () => {
    const api = makeRowPageApi({
      dbName: 'Lectures',
      rows: [
        { id: 'row-1', properties: { Name: titleProp('Lecture 1') } },
        { id: 'row-2', properties: { Name: titleProp('Lecture 2') } },
        { id: 'row-3', properties: { Name: titleProp('Lecture 3') } },
      ],
      titlesByPage: {
        'row-1': 'Lecture 1',
        'row-2': 'Lecture 2',
        'row-3': 'Lecture 3',
      },
      blocksByPage: {
        'row-1': [toggleBlock('t-1', 'First?')],
        'row-2': [paragraphBlock('p-2', 'empty row, no toggles')],
        'row-3': [toggleBlock('t-3', 'Third?')],
        't-1': [paragraphBlock('a-1', 'First answer.')],
        't-3': [paragraphBlock('a-3', 'Third answer.')],
      },
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const decksWithCards = decks.filter((d) => d.cards.length > 0);
    expect(decksWithCards.map((d) => [d.name, d.cards[0].name])).toEqual([
      ['Lectures::Lecture 1', 'First?'],
      ['Lectures::Lecture 3', 'Third?'],
    ]);
  });

  it('walks row pages when a multi-property database (Name + Tags) has no text back column', async () => {
    const api = makeRowPageApi({
      dbName: 'Lectures',
      rows: [
        {
          id: 'row-1',
          properties: {
            Name: titleProp('Lecture 1'),
            Tags: multiSelectProp('biology'),
          },
        },
      ],
      titlesByPage: { 'row-1': 'Lecture 1' },
      blocksByPage: {
        'row-1': [toggleBlock('t-1', 'What is a neuron?')],
        't-1': [paragraphBlock('p-1', 'A nerve cell.')],
      },
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.map((d) => d.name)).toEqual(['Lectures::Lecture 1']);
    expect(decks[0].cards.map((c) => c.name)).toEqual(['What is a neuron?']);
    expect(bl.guessedColumnMapping).toBeUndefined();
    expect(bl.resolvedDatabasePath).toEqual({
      viaPageLinkSelfHeal: false,
      rowPageWalk: true,
      rowPagesSkipped: 0,
      rowPagesErrored: 0,
    });
  });

  it('gives the empty-answers reason when every row inside the free cap is blank, without naming the rows past it', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `row-${i}`,
      properties: { Name: titleProp(`Lecture ${i}`) },
    }));
    const blocksByPage: Record<string, unknown[]> = {};
    for (let i = 0; i < 30; i += 1) {
      blocksByPage[`row-${i}`] = [toggleBlock(`t-${i}`, `Q${i}?`)];
      blocksByPage[`t-${i}`] = [
        paragraphBlock(`a-${i}`, i < 25 ? '' : `A${i}.`),
      ];
    }
    const bl = makeHandler(makeRowPageApi({ rows, blocksByPage }));
    bl.useAll = false;

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.flatMap((d) => d.cards)).toEqual([]);
    expect(bl.emptyDeckReason()).toBe('empty_answers');
    expect(bl.resolvedDatabasePath).toEqual({ viaPageLinkSelfHeal: false });
  });

  it('caps the free-plan walk at 25 row pages and records the rest as skipped', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `row-${i}`,
      properties: { Name: titleProp(`Lecture ${i}`) },
    }));
    const blocksByPage: Record<string, unknown[]> = {};
    for (let i = 0; i < 30; i += 1) {
      blocksByPage[`row-${i}`] = [toggleBlock(`t-${i}`, `Q${i}?`)];
      blocksByPage[`t-${i}`] = [paragraphBlock(`a-${i}`, `A${i}.`)];
    }
    const api = makeRowPageApi({ rows, blocksByPage });
    const bl = makeHandler(api);
    bl.useAll = false;

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.filter((d) => d.cards.length > 0)).toHaveLength(25);
    expect(bl.resolvedDatabasePath).toEqual({
      viaPageLinkSelfHeal: false,
      rowPageWalk: true,
      rowPagesSkipped: 5,
      rowPagesErrored: 0,
    });
  });

  it('walks up to 250 row pages on a paid conversion', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: `row-${i}`,
      properties: { Name: titleProp(`Lecture ${i}`) },
    }));
    const blocksByPage: Record<string, unknown[]> = {};
    for (let i = 0; i < 30; i += 1) {
      blocksByPage[`row-${i}`] = [toggleBlock(`t-${i}`, `Q${i}?`)];
      blocksByPage[`t-${i}`] = [paragraphBlock(`a-${i}`, `A${i}.`)];
    }
    const api = makeRowPageApi({ rows, blocksByPage });
    const bl = makeHandler(api);
    bl.useAll = true;

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.filter((d) => d.cards.length > 0)).toHaveLength(30);
    expect(bl.resolvedDatabasePath).toEqual({
      viaPageLinkSelfHeal: false,
      rowPageWalk: true,
      rowPagesSkipped: 0,
      rowPagesErrored: 0,
    });
  });

  function rowsWithToggles(count: number): {
    rows: IdentifiedRow[];
    blocksByPage: Record<string, unknown[]>;
  } {
    const rows = Array.from({ length: count }, (_, i) => ({
      id: `row-${i}`,
      properties: { Name: titleProp(`Lecture ${i}`) },
    }));
    const blocksByPage: Record<string, unknown[]> = {};
    for (let i = 0; i < count; i += 1) {
      blocksByPage[`row-${i}`] = [toggleBlock(`t-${i}`, `Q${i}?`)];
      blocksByPage[`t-${i}`] = [paragraphBlock(`a-${i}`, `A${i}.`)];
    }
    return { rows, blocksByPage };
  }

  it('fires the job heartbeat after every row, even with fewer than ten rows', async () => {
    const api = makeRowPageApi(rowsWithToggles(3));
    const bl = makeHandler(api);
    bl.useAll = true;
    const heartbeat = vi.fn().mockResolvedValue(true);
    bl.heartbeat = heartbeat;

    await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(heartbeat).toHaveBeenCalledTimes(3);
  });

  it('still fires the heartbeat for a row page that throws', async () => {
    const api = makeRowPageApi({
      rows: [
        { id: 'row-1', properties: { Name: titleProp('Lecture 1') } },
        { id: 'row-2', properties: { Name: titleProp('Lecture 2') } },
      ],
      blocksByPage: {
        'row-2': [toggleBlock('t-2', 'Survivor?')],
        't-2': [paragraphBlock('p-2', 'Still here.')],
      },
    });
    (api.getPage as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: string) => {
        if (id === 'row-1') {
          throw makeAPIResponseError(APIErrorCode.ObjectNotFound);
        }
        return { id, object: 'page', created_time: '', last_edited_time: '' };
      }
    );
    const bl = makeHandler(api);
    bl.useAll = true;
    const heartbeat = vi.fn().mockResolvedValue(true);
    bl.heartbeat = heartbeat;

    await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it('stops the walk when the heartbeat reports the job is gone', async () => {
    const api = makeRowPageApi(rowsWithToggles(5));
    const bl = makeHandler(api);
    bl.useAll = true;
    let calls = 0;
    bl.heartbeat = vi.fn(async () => {
      calls += 1;
      return calls < 2;
    });

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.filter((d) => d.cards.length > 0)).toHaveLength(2);
    expect(bl.resolvedDatabasePath?.rowPagesSkipped).toBe(3);
  });

  it('a DB error in the heartbeat does not fail or stop the walk', async () => {
    const api = makeRowPageApi(rowsWithToggles(3));
    const bl = makeHandler(api);
    bl.useAll = true;
    bl.heartbeat = vi.fn().mockRejectedValue(new Error('db down'));

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.filter((d) => d.cards.length > 0)).toHaveLength(3);
  });

  it('stops the walk once the per-conversion fetch budget is spent', async () => {
    const api = makeRowPageApi(rowsWithToggles(3));
    const bl = makeHandler(api);
    bl.useAll = true;
    bl.maxRowWalkFetches = 4;

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const withCards = decks.filter((d) => d.cards.length > 0);
    expect(withCards).toHaveLength(1);
    expect(withCards[0].cards).toHaveLength(1);
    expect(bl.resolvedDatabasePath).toEqual({
      viaPageLinkSelfHeal: false,
      rowPageWalk: true,
      rowPagesSkipped: 2,
      rowPagesErrored: 0,
    });
  });

  it('skips a row page that 404s and keeps the rest', async () => {
    const api = makeRowPageApi({
      dbName: 'Lectures',
      rows: [
        { id: 'row-1', properties: { Name: titleProp('Lecture 1') } },
        { id: 'row-2', properties: { Name: titleProp('Lecture 2') } },
      ],
      titlesByPage: { 'row-1': 'Lecture 1', 'row-2': 'Lecture 2' },
      blocksByPage: {
        'row-2': [toggleBlock('t-2', 'Survivor?')],
        't-2': [paragraphBlock('p-2', 'Still here.')],
      },
    });
    (api.getPage as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: string) => {
        if (id === 'row-1') {
          throw makeAPIResponseError(APIErrorCode.ObjectNotFound);
        }
        return { id, object: 'page', created_time: '', last_edited_time: '' };
      }
    );
    const bl = makeHandler(api);
    bl.useAll = true;

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const withCards = decks.filter((d) => d.cards.length > 0);
    expect(withCards.map((d) => d.name)).toEqual(['Lectures::Lecture 2']);
    expect(bl.resolvedDatabasePath).toEqual({
      viaPageLinkSelfHeal: false,
      rowPageWalk: true,
      rowPagesSkipped: 0,
      rowPagesErrored: 1,
    });
  });

  it('rethrows a rate-limited row error instead of skipping it', async () => {
    const api = makeRowPageApi(rowsWithToggles(3));
    (api.getPage as ReturnType<typeof vi.fn>).mockRejectedValue(
      makeAPIResponseError(APIErrorCode.RateLimited)
    );
    const bl = makeHandler(api);
    bl.useAll = true;

    await expect(
      bl.findFlashcards({
        parentType: 'notion-database',
        topLevelId: 'db-1',
        rules: new ParserRules(),
        decks: [],
        parentName: '',
      })
    ).rejects.toBeInstanceOf(APIResponseError);
  });

  it('abandons the walk after three consecutive row failures', async () => {
    const api = makeRowPageApi(rowsWithToggles(10));
    (api.getPage as ReturnType<typeof vi.fn>).mockRejectedValue(
      makeAPIResponseError(APIErrorCode.ObjectNotFound)
    );
    const bl = makeHandler(api);
    bl.useAll = true;

    await expect(
      bl.findFlashcards({
        parentType: 'notion-database',
        topLevelId: 'db-1',
        rules: new ParserRules(),
        decks: [],
        parentName: '',
      })
    ).rejects.toThrow();
    expect(api.getPage).toHaveBeenCalledTimes(3);
  });

  it('never walks row pages when the two columns already produce cards', async () => {
    const api = makeRowPageApi({
      rows: [
        {
          id: 'row-1',
          properties: {
            Term: titleProp('aller'),
            Definition: richTextProp('to go'),
          },
        },
      ],
      blocksByPage: {},
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks[0].cards.map((c) => c.name)).toEqual(['aller']);
    expect(api.getPage).not.toHaveBeenCalled();
    expect(bl.resolvedDatabasePath).toEqual({ viaPageLinkSelfHeal: false });
  });

  it('does not walk row pages when the user explicitly picked columns that do not exist', async () => {
    const api = makeRowPageApi({
      rows: [{ id: 'row-1', properties: { Name: titleProp('Lecture 1') } }],
      blocksByPage: { 'row-1': [toggleBlock('t-1', 'Would be a card')] },
    });
    const bl = makeHandler(api);

    await expect(
      bl.findFlashcards({
        parentType: 'notion-database',
        topLevelId: 'db-1',
        rules: new ParserRules(),
        decks: [],
        parentName: '',
        frontField: 'Nope',
        backField: 'Also Nope',
      })
    ).rejects.toThrow(NotionDatabaseColumnsError);
    expect(api.getPage).not.toHaveBeenCalled();
  });

  it('asks for rows when the database has none', async () => {
    const api = makeApi({ rows: [] });
    const bl = makeHandler(api);

    await expect(
      bl.findFlashcards({
        parentType: 'notion-database',
        topLevelId: 'db-1',
        rules: new ParserRules(),
        decks: [],
        parentName: '',
      })
    ).rejects.toThrow(
      'This database has no rows yet. Add a row with a front and a back column filled in, then convert again.'
    );
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
    ).rejects.toThrow(
      'This database has no columns named "Nope" or "Also Nope". It has "Term" and "Definition". Pick columns it has for the front and the back, then convert again.'
    );
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
    vi.spyOn(bl, 'findFlashcardsFromPage').mockRejectedValue({
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

  it('leaves the deck empty when no column pair yields a card and the row pages are empty too', async () => {
    const api = makeRowPageApi({
      rows: [
        {
          id: 'row-1',
          properties: {
            Status: richTextProp(''),
            Owner: richTextProp(''),
          },
        },
      ],
      blocksByPage: {
        'row-1': [paragraphBlock('p-1', 'just prose, nothing card-shaped')],
      },
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'notion-database',
      topLevelId: 'db-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.every((d) => d.cards.length === 0)).toBe(true);
    expect(api.getPage).toHaveBeenCalledWith('row-1');
    expect(bl.resolvedDatabasePath).toEqual({ viaPageLinkSelfHeal: false });
  });
});
