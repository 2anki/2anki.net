import { vi } from 'vitest';
import BlockHandler from './BlockHandler';
import Note from '../../../lib/parser/Note';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import NotionAPIWrapper from '../NotionAPIWrapper';
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

function layoutBlock(id: string, type: 'column_list' | 'column') {
  return {
    object: 'block',
    id,
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: true,
    archived: false,
    in_trash: false,
    type,
    [type]: {},
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

function childPageBlock(id: string, title: string) {
  return {
    object: 'block',
    id,
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: true,
    archived: false,
    in_trash: false,
    type: 'child_page',
    child_page: { title },
  };
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

describe('top-level column layout on the convert path', () => {
  it('cards toggles nested inside a two-column layout instead of dropping them', async () => {
    const api = makeApi({
      'page-1': [layoutBlock('cl-1', 'column_list')],
      'cl-1': [layoutBlock('col-0', 'column'), layoutBlock('col-1', 'column')],
      'col-0': [textBlock('t-left', 'toggle', 'Left question', true)],
      'col-1': [textBlock('t-right', 'toggle', 'Right question', true)],
      't-left': [textBlock('p-left', 'paragraph', 'Left answer')],
      't-right': [textBlock('p-right', 'paragraph', 'Right answer')],
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
    const cards = decks[0].cards;
    expect(cards).toHaveLength(2);
    const byFront = (needle: string) =>
      cards.find((c) => c.name.includes(needle));
    expect(byFront('Left question')).toBeDefined();
    expect(byFront('Right question')).toBeDefined();
    expect(byFront('Left question')!.back).toContain('Left answer');
    expect(byFront('Right question')!.back).toContain('Right answer');
  });

  it('keeps column order when flattening sequential column content', async () => {
    const api = makeApi({
      'page-1': [layoutBlock('cl-1', 'column_list')],
      'cl-1': [layoutBlock('col-0', 'column'), layoutBlock('col-1', 'column')],
      'col-0': [textBlock('t-left', 'toggle', 'First', true)],
      'col-1': [textBlock('t-right', 'toggle', 'Second', true)],
      't-left': [textBlock('p-left', 'paragraph', 'a')],
      't-right': [textBlock('p-right', 'paragraph', 'b')],
    });
    const handler = makeHandler(api);

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const names = decks[0].cards.map((c) => c.name);
    expect(names[0]).toContain('First');
    expect(names[1]).toContain('Second');
  });

  it('still builds a two-column Q/A card when column_list is a flashcard type', async () => {
    const api = makeApi({
      'page-1': [layoutBlock('cl-1', 'column_list')],
      'cl-1': [layoutBlock('col-0', 'column'), layoutBlock('col-1', 'column')],
      'col-0': [textBlock('q', 'paragraph', 'Question side')],
      'col-1': [textBlock('a', 'paragraph', 'Answer side')],
    });
    const handler = makeHandler(api);
    const rules = new ParserRules();
    rules.setFlashcardTypes(['column_list']);

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules,
      decks: [],
      parentName: '',
    });

    expect(decks).toHaveLength(1);
    const cards = decks[0].cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain('Question side');
    expect(cards[0].name).not.toContain('Answer side');
    expect(cards[0].back).toContain('Answer side');
  });

  it('does not turn a child_page inside a column into a sub-deck', async () => {
    const api = makeApi({
      'page-1': [layoutBlock('cl-1', 'column_list')],
      'cl-1': [layoutBlock('col-0', 'column')],
      'col-0': [
        childPageBlock('cp-1', 'Nested subpage'),
        textBlock('t-1', 'toggle', 'A real toggle', true),
      ],
      't-1': [textBlock('p-1', 'paragraph', 'Toggle answer')],
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
    expect(decks[0].cards[0].name).toContain('A real toggle');
    expect(api.getPage).not.toHaveBeenCalledWith('cp-1');
  });

  it('does not turn a child_database inside a column into a sub-deck', async () => {
    const api = makeApi({
      'page-1': [layoutBlock('cl-1', 'column_list')],
      'cl-1': [layoutBlock('col-0', 'column')],
      'col-0': [
        {
          object: 'block',
          id: 'cdb-1',
          parent: { type: 'page_id', page_id: 'page-1' },
          created_time: '',
          last_edited_time: '',
          created_by: { object: 'user', id: 'u' },
          last_edited_by: { object: 'user', id: 'u' },
          has_children: true,
          archived: false,
          in_trash: false,
          type: 'child_database',
          child_database: { title: 'Nested database' },
        },
        textBlock('t-1', 'toggle', 'A real toggle', true),
      ],
      't-1': [textBlock('p-1', 'paragraph', 'Toggle answer')],
    });
    const handler = makeHandler(api);
    handler.useAll = true;

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks).toHaveLength(1);
    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toContain('A real toggle');
  });

  it('skips flattening when column_list is a configured deck type', async () => {
    const api = makeApi({
      'page-1': [layoutBlock('cl-1', 'column_list')],
      'cl-1': [layoutBlock('col-0', 'column'), layoutBlock('col-1', 'column')],
      'col-0': [textBlock('t-left', 'toggle', 'Left question', true)],
      'col-1': [textBlock('t-right', 'toggle', 'Right question', true)],
      't-left': [textBlock('p-left', 'paragraph', 'Left answer')],
      't-right': [textBlock('p-right', 'paragraph', 'Right answer')],
    });
    const handler = makeHandler(api);
    handler.useAll = true;
    const rules = new ParserRules();
    rules.setDeckTypes(['page', 'column_list']);

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules,
      decks: [],
      parentName: '',
    });

    expect(decks[0].cards).toHaveLength(0);
  });
});

describe('heading context does not leak out of a column layout', () => {
  const pageWithColumnHeading = () =>
    makeApi({
      'page-1': [
        textBlock('h-top', 'heading_1', 'Top'),
        textBlock('t-1', 'toggle', 'First concept', true),
        layoutBlock('cl-1', 'column_list'),
        textBlock('t-2', 'toggle', 'Second concept', true),
      ],
      'cl-1': [layoutBlock('col-0', 'column')],
      'col-0': [
        textBlock('h-side', 'heading_2', 'Sidebar'),
        textBlock('t-3', 'toggle', 'Sidebar note', true),
      ],
      't-1': [textBlock('p-1', 'paragraph', 'a1')],
      't-2': [textBlock('p-2', 'paragraph', 'a2')],
      't-3': [textBlock('p-3', 'paragraph', 'a3')],
    });

  const findCard = (cards: Note[], needle: string) =>
    cards.find((c) => c.name.includes(needle));

  it('does not retag a card after the column with the column heading', async () => {
    const handler = makeHandler(pageWithColumnHeading());
    const rules = new ParserRules();
    rules.TAGS = 'heading';

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules,
      decks: [],
      parentName: '',
    });

    const first = findCard(decks[0].cards, 'First concept')!;
    const second = findCard(decks[0].cards, 'Second concept')!;
    expect(first.tags).toEqual(['Top']);
    expect(second.tags).toEqual(['Top']);
    expect(second.tags).not.toContain('Sidebar');
  });

  it('does not leak the column heading into the hierarchy breadcrumb', async () => {
    const handler = makeHandler(
      pageWithColumnHeading(),
      new CardOption({ template: 'hierarchy' })
    );

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const second = findCard(decks[0].cards, 'Second concept')!;
    expect(second.h1).toBe('Top');
    expect(second.h2).toBe('');
  });
});

describe('column cards do not suppress the empty-deck rescue', () => {
  it('rescues heading cards from the page and still cards a column toggle', async () => {
    const api = makeApi({
      'page-1': [
        textBlock('h-a', 'heading_2', 'Alpha'),
        textBlock('p-a', 'paragraph', 'Alpha is the first concept.'),
        textBlock('h-b', 'heading_2', 'Beta'),
        textBlock('p-b', 'paragraph', 'Beta is the second concept.'),
        textBlock('h-c', 'heading_2', 'Gamma'),
        textBlock('p-c', 'paragraph', 'Gamma is the third concept.'),
        layoutBlock('cl-1', 'column_list'),
      ],
      'cl-1': [layoutBlock('col-0', 'column')],
      'col-0': [textBlock('t-colq', 'toggle', 'ColQ', true)],
      't-colq': [textBlock('p-colq', 'paragraph', 'Column answer')],
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
    const fronts = decks[0].cards.map((c) => c.name.replace(/<[^>]*>/g, ''));
    expect(fronts).toHaveLength(4);
    expect(fronts).toEqual(expect.arrayContaining(['Alpha', 'Beta', 'Gamma']));
    expect(fronts.some((f) => f.includes('ColQ'))).toBe(true);
    expect(handler.inducedRule).toMatchObject({
      rule: 'heading',
      outcome: 'rescue_shipped',
    });
  });
});
