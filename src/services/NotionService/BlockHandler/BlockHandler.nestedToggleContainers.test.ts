import { vi } from 'vitest';
import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { DeckParser } from '../../../lib/parser/DeckParser';
import { setupTests } from '../../../test/configure-jest';

beforeEach(() => setupTests());

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

function textBlock(
  id: string,
  type: string,
  content: string,
  hasChildren = false
) {
  return {
    object: 'block',
    id,
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: hasChildren,
    archived: false,
    in_trash: false,
    type,
    [type]: { rich_text: [richText(content)], color: 'default' },
  };
}

function blockList(results: unknown[]) {
  return {
    object: 'list',
    results,
    next_cursor: null,
    has_more: false,
    type: 'block',
    block: {},
  };
}

function makeApi(childrenById: Record<string, unknown[]>): NotionAPIWrapper {
  return {
    getPage: vi.fn().mockResolvedValue({
      id: 'page-1',
      object: 'page',
      created_time: '',
      last_edited_time: '',
    }),
    getPageTitle: vi.fn().mockResolvedValue('Study Notes'),
    getTopLevelTags: vi.fn().mockResolvedValue([]),
    getBlocks: vi
      .fn()
      .mockImplementation(({ id }: { id: string }) =>
        Promise.resolve(blockList(childrenById[id] ?? []))
      ),
  } as unknown as NotionAPIWrapper;
}

function makeHandler(
  api: NotionAPIWrapper,
  settings: CardOption = new CardOption({})
): BlockHandler {
  return new BlockHandler(
    new CustomExporter('', new Workspace(true, 'fs').location),
    api,
    settings
  );
}

const stripTags = (html: string) => html.replace(/<[^>]*>/g, '').trim();

describe('toggles nested in list items and callouts on the convert path', () => {
  it('cards a toggle nested in a bulleted list item', async () => {
    const api = makeApi({
      'page-1': [textBlock('b-1', 'bulleted_list_item', 'Topic bullet', true)],
      'b-1': [textBlock('t-b', 'toggle', 'Bullet question', true)],
      't-b': [textBlock('p-b', 'paragraph', 'Bullet answer')],
    });
    const handler = makeHandler(api);

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toContain('Bullet question');
    expect(decks[0].cards[0].back).toContain('Bullet answer');
  });

  it('cards a toggle nested in a numbered list item', async () => {
    const api = makeApi({
      'page-1': [textBlock('n-1', 'numbered_list_item', 'Step one', true)],
      'n-1': [textBlock('t-n', 'toggle', 'Numbered question', true)],
      't-n': [textBlock('p-n', 'paragraph', 'Numbered answer')],
    });
    const handler = makeHandler(api);

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toContain('Numbered question');
    expect(decks[0].cards[0].back).toContain('Numbered answer');
  });

  it('cards a toggle nested in a callout', async () => {
    const api = makeApi({
      'page-1': [textBlock('c-1', 'callout', 'Note heading', true)],
      'c-1': [textBlock('t-c', 'toggle', 'Callout question', true)],
      't-c': [textBlock('p-c', 'paragraph', 'Callout answer')],
    });
    const handler = makeHandler(api);

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toContain('Callout question');
    expect(decks[0].cards[0].back).toContain('Callout answer');
  });

  it('cards a toggle nested two containers deep', async () => {
    const api = makeApi({
      'page-1': [textBlock('c-1', 'callout', 'Outer note', true)],
      'c-1': [textBlock('b-1', 'bulleted_list_item', 'Inner bullet', true)],
      'b-1': [textBlock('t-1', 'toggle', 'Deep question', true)],
      't-1': [textBlock('p-1', 'paragraph', 'Deep answer')],
    });
    const handler = makeHandler(api);

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toContain('Deep question');
    expect(decks[0].cards[0].back).toContain('Deep answer');
  });

  it('does not double-card when the callout itself is a flashcard type', async () => {
    const api = makeApi({
      'page-1': [textBlock('c-1', 'callout', 'Callout front', true)],
      'c-1': [textBlock('t-c', 'toggle', 'Inner question', true)],
      't-c': [textBlock('p-c', 'paragraph', 'Inner answer')],
    });
    const handler = makeHandler(api);
    const rules = new ParserRules();
    rules.setFlashcardTypes(['toggle', 'callout']);

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules,
      decks: [],
      parentName: '',
    });

    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toContain('Callout front');
  });

  it('leaves a bullet that wraps no toggle alone', async () => {
    const api = makeApi({
      'page-1': [
        textBlock('t-top', 'toggle', 'Top question', true),
        textBlock('b-1', 'bulleted_list_item', 'Just a bullet', true),
      ],
      't-top': [textBlock('p-top', 'paragraph', 'Top answer')],
      'b-1': [textBlock('b-2', 'bulleted_list_item', 'Nested bullet')],
    });
    const handler = makeHandler(api);

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toContain('Top question');
  });

  it('keeps a hoisted toggle in document order among top-level toggles', async () => {
    const api = makeApi({
      'page-1': [
        textBlock('t-x', 'toggle', 'Top one', true),
        textBlock('b-1', 'bulleted_list_item', 'A bullet', true),
        textBlock('t-z', 'toggle', 'Top two', true),
      ],
      't-x': [textBlock('p-x', 'paragraph', 'Answer one')],
      'b-1': [textBlock('t-y', 'toggle', 'Nested toggle', true)],
      't-y': [textBlock('p-y', 'paragraph', 'Nested answer')],
      't-z': [textBlock('p-z', 'paragraph', 'Answer two')],
    });
    const handler = makeHandler(api);

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks[0].cards.map((c) => stripTags(c.name))).toEqual([
      'Top one',
      'Nested toggle',
      'Top two',
    ]);
  });

  it('skips a wrapper the user made a deck type instead of double-carding', async () => {
    const api = makeApi({
      'page-1': [
        textBlock('b-1', 'bulleted_list_item', 'Section bullet', true),
      ],
      'b-1': [textBlock('t-1', 'toggle', 'Inner question', true)],
      't-1': [textBlock('p-1', 'paragraph', 'Inner answer')],
    });
    const handler = makeHandler(api);
    handler.useAll = true;
    const rules = new ParserRules();
    rules.setDeckTypes(['page', 'bulleted_list_item']);

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules,
      decks: [],
      parentName: '',
    });

    expect(decks[0].cards).toHaveLength(0);
    const total = decks
      .flatMap((d) => d.cards)
      .filter((c) => c.name.includes('Inner question'));
    expect(total).toHaveLength(1);
  });

  it('bounds wrapper fetches on a large toggle-free outline', async () => {
    const childrenById: Record<string, unknown[]> = { 'page-1': [] };
    for (let i = 0; i < 100; i += 1) {
      const id = `b-${i}`;
      (childrenById['page-1'] as unknown[]).push(
        textBlock(id, 'bulleted_list_item', `Item ${i}`, true)
      );
      childrenById[id] = [
        textBlock(`leaf-${i}`, 'bulleted_list_item', `Leaf ${i}`, false),
      ];
    }
    let getBlocksCalls = 0;
    const api = {
      getPage: vi.fn().mockResolvedValue({
        id: 'page-1',
        object: 'page',
        created_time: '',
        last_edited_time: '',
      }),
      getPageTitle: vi.fn().mockResolvedValue('Outline'),
      getTopLevelTags: vi.fn().mockResolvedValue([]),
      getBlocks: vi.fn().mockImplementation(({ id }: { id: string }) => {
        getBlocksCalls += 1;
        return Promise.resolve(blockList(childrenById[id] ?? []));
      }),
    } as unknown as NotionAPIWrapper;
    const handler = makeHandler(api);

    await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(getBlocksCalls).toBeLessThanOrEqual(41);
  });

  it('records truncation when a free-plan wrapper fetch is partial', async () => {
    const childrenById: Record<string, unknown[]> = {
      'page-1': [textBlock('b-1', 'bulleted_list_item', 'A bullet', true)],
      'b-1': [textBlock('t-1', 'toggle', 'Question', true)],
      't-1': [textBlock('p-1', 'paragraph', 'Answer')],
    };
    const api = {
      getPage: vi.fn().mockResolvedValue({
        id: 'page-1',
        object: 'page',
        created_time: '',
        last_edited_time: '',
      }),
      getPageTitle: vi.fn().mockResolvedValue('Notes'),
      getTopLevelTags: vi.fn().mockResolvedValue([]),
      getBlocks: vi.fn().mockImplementation(({ id }: { id: string }) =>
        Promise.resolve({
          ...blockList(childrenById[id] ?? []),
          has_more: id === 'b-1',
        })
      ),
    } as unknown as NotionAPIWrapper;
    const handler = makeHandler(api);
    handler.useAll = false;

    await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(handler.truncation?.blocksConverted).toBe(1);
  });
});

describe('parity with the upload path for a toggle inside a callout', () => {
  const uploadCardsFor = async (body: string) => {
    const html = `<html><head><title>Notes</title></head><body><article class="page sans"><header><h1 class="page-title">Notes</h1></header><div class="page-body">${body}</div></article></body></html>`;
    const workspace = new Workspace(true, 'fs');
    const parser = new DeckParser({
      name: 'notes.html',
      settings: new CardOption({ cherry: 'false' }),
      files: [{ name: 'notes.html', contents: html }],
      noLimits: true,
      workspace,
    });
    try {
      await parser.build(workspace);
    } catch {
      // Packaging needs the Python venv; parsed cards live on payload already.
    }
    return parser.payload.flatMap((deck) => deck.cards);
  };

  it('both paths produce one card with the same front and back', async () => {
    const uploadCards = await uploadCardsFor(
      `<figure class="callout" style="display:flex"><div style="width:100%">` +
        `<details open="" class="toggle" id="t-1"><summary>Capital of France?</summary>` +
        `<div class="indented"><p>Paris</p></div></details></div></figure>`
    );

    const api = makeApi({
      'page-1': [textBlock('c-1', 'callout', 'Geography', true)],
      'c-1': [textBlock('t-1', 'toggle', 'Capital of France?', true)],
      't-1': [textBlock('p-1', 'paragraph', 'Paris')],
    });
    const notionCards = (
      await makeHandler(api).findFlashcards({
        parentType: 'page',
        topLevelId: 'page-1',
        rules: new ParserRules(),
        decks: [],
        parentName: '',
      })
    )[0].cards;

    expect(uploadCards).toHaveLength(1);
    expect(notionCards).toHaveLength(1);
    expect(stripTags(notionCards[0].name)).toBe(stripTags(uploadCards[0].name));
    expect(stripTags(notionCards[0].back)).toContain('Paris');
    expect(stripTags(uploadCards[0].back)).toContain('Paris');
  });
});
