import BlockHandler from './BlockHandler';
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
    getPage: jest.fn().mockResolvedValue({
      id: 'page-1',
      object: 'page',
      created_time: '',
      last_edited_time: '',
    }),
    getPageTitle: jest.fn().mockResolvedValue('Study Notes'),
    getTopLevelTags: jest.fn().mockResolvedValue([]),
    getBlocks: jest
      .fn()
      .mockImplementation(({ id }: { id: string }) =>
        Promise.resolve(blockList(childrenById[id] ?? []))
      ),
  } as unknown as NotionAPIWrapper;
}

function makeHandler(api: NotionAPIWrapper): BlockHandler {
  return new BlockHandler(
    new CustomExporter('', new Workspace(true, 'fs').location),
    api,
    new CardOption({})
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
});
