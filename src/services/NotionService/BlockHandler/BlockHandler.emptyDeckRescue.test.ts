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

function block(type: string, content: string, hasChildren = false) {
  return {
    object: 'block',
    id: `${type}-${content.slice(0, 12)}`,
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

describe('empty-deck rescue on the page branch', () => {
  it('rescues a page whose only card blocks are empty toggles', async () => {
    const emptyToggle = block('toggle', 'A toggle with nothing inside');
    const api = makeApi({
      'page-1': [
        emptyToggle,
        block('heading_2', 'What is spaced repetition?'),
        block('paragraph', 'A method that spaces reviews over time.'),
      ],
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
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain('spaced repetition');
    expect(cards[0].back).toContain('spaces reviews');
  });

  it('counts the rescued cards rather than the discarded empty toggles', async () => {
    const api = makeApi({
      'page-1': [
        block('toggle', 'Empty one'),
        block('toggle', 'Empty two'),
        block('heading_2', 'What is a flashcard?'),
        block('paragraph', 'A prompt paired with an answer.'),
      ],
    });
    const handler = makeHandler(api);

    await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(handler.cardCount).toBe(1);
    expect(handler.emptyBackCount).toBe(0);
  });
});

describe('empty-deck rescue on the sub-deck branch', () => {
  function subDeckRules() {
    const rules = new ParserRules();
    rules.setDeckTypes(['page', 'heading_1']);
    return rules;
  }

  it('rescues a sub-deck built from block children with no toggles', async () => {
    const chapter = block('heading_1', 'Chapter 1', true);
    const api = makeApi({
      'page-1': [chapter],
      [chapter.id]: [
        block('heading_2', 'What is an enzyme?'),
        block('paragraph', 'A protein that speeds up a reaction.'),
      ],
    });
    const handler = makeHandler(api);
    handler.useAll = true;

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: subDeckRules(),
      decks: [],
      parentName: '',
    });

    const rescued = decks.flatMap((deck) => deck.cards);
    expect(rescued).toHaveLength(1);
    expect(rescued[0].name).toContain('enzyme');
    expect(rescued[0].back).toContain('speeds up a reaction');
  });

  it('adds no Notion requests beyond the ones the walk already makes', async () => {
    const chapter = block('heading_1', 'Chapter 1', true);
    const api = makeApi({
      'page-1': [chapter],
      [chapter.id]: [
        block('heading_2', 'What is an enzyme?'),
        block('paragraph', 'A protein that speeds up a reaction.'),
      ],
    });
    const handler = makeHandler(api);
    handler.useAll = true;

    await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: subDeckRules(),
      decks: [],
      parentName: '',
    });
    const withRescue = (api.getBlocks as jest.Mock).mock.calls.length;

    const baselineApi = makeApi({
      'page-1': [chapter],
      [chapter.id]: [block('paragraph', 'Nothing card-shaped in here at all.')],
    });
    const baselineHandler = makeHandler(baselineApi);
    baselineHandler.useAll = true;
    await baselineHandler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: subDeckRules(),
      decks: [],
      parentName: '',
    });

    expect(withRescue).toBe(
      (baselineApi.getBlocks as jest.Mock).mock.calls.length
    );
  });
});
