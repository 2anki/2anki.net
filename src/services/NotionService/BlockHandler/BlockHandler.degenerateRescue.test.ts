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
    id: `${type}-${content.slice(0, 16)}`,
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

function todo(content: string, checked: boolean) {
  return {
    object: 'block',
    id: `to_do-${content.slice(0, 16)}`,
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'to_do',
    to_do: { rich_text: [richText(content)], color: 'default', checked },
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

function makeHandler(api: NotionAPIWrapper, settings = new CardOption({})) {
  return new BlockHandler(
    new CustomExporter('', new Workspace(true, 'fs').location),
    api,
    settings
  );
}

const oversizedBack =
  'Photosynthesis converts light energy into chemical energy stored in glucose. '.repeat(
    20
  );

function headingPairs() {
  return [
    block('heading_2', 'What is the cell membrane?'),
    block(
      'paragraph',
      'A lipid bilayer that separates the cell interior from its surroundings.'
    ),
    block('heading_2', 'What is the nucleus?'),
    block('paragraph', 'The organelle that houses the genetic material.'),
    block('heading_2', 'What are mitochondria?'),
    block('paragraph', 'Organelles that generate most of the chemical energy.'),
    block('heading_2', 'What is the cytoplasm?'),
    block('paragraph', 'The gel-like fluid that fills the interior of a cell.'),
  ];
}

describe('degenerate-yield rescue on the page branch', () => {
  it('splits a single oversized toggle card into the page headings', async () => {
    const toggle = block('toggle', 'Cell biology overview', true);
    const api = makeApi({
      'page-1': [toggle, ...headingPairs()],
      [toggle.id]: [block('paragraph', oversizedBack)],
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
    expect(cards.length).toBeGreaterThanOrEqual(3);
    expect(cards[0].name).toContain('cell membrane');
    expect(cards[0].back).toContain('lipid bilayer');
    expect(handler.inducedRule).toMatchObject({
      rule: 'heading',
      outcome: 'rescue_shipped',
    });
  });

  it('counts the rescued cards rather than the discarded oversized card', async () => {
    const toggle = block('toggle', 'Cell biology overview', true);
    const api = makeApi({
      'page-1': [toggle, ...headingPairs()],
      [toggle.id]: [block('paragraph', oversizedBack)],
    });
    const handler = makeHandler(api);

    await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(handler.cardCount).toBe(4);
    expect(handler.emptyBackCount).toBe(0);
  });

  it('leaves a legitimate small deck of short cards untouched', async () => {
    const first = block('toggle', 'What is spaced repetition?', true);
    const second = block('toggle', 'What is active recall?', true);
    const api = makeApi({
      'page-1': [first, second, ...headingPairs()],
      [first.id]: [
        block('paragraph', 'Reviews spaced further apart over time.'),
      ],
      [second.id]: [
        block(
          'paragraph',
          'Retrieving a fact from memory rather than rereading.'
        ),
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

    expect(decks[0].cards).toHaveLength(2);
    expect(handler.inducedRule).toBeUndefined();
  });

  it('keeps the oversized card and records rescue_rejected below the floor', async () => {
    const toggle = block('toggle', 'Cell biology overview', true);
    const api = makeApi({
      'page-1': [
        toggle,
        block('heading_2', 'What is the cell membrane?'),
        block(
          'paragraph',
          'A lipid bilayer that separates the cell interior from its surroundings.'
        ),
      ],
      [toggle.id]: [block('paragraph', oversizedBack)],
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
    expect(decks[0].cards[0].back).toContain('Photosynthesis');
    expect(handler.inducedRule).toMatchObject({
      outcome: 'rescue_rejected',
    });
  });

  it('never shreds an oversized MCQ card into structural cards', async () => {
    const question = `Which organelle is the site of aerobic respiration? ${'Consider the role each structure plays in energy metabolism before answering. '.repeat(
      14
    )}`;
    const toggle = block('toggle', question, true);
    const api = makeApi({
      'page-1': [toggle, ...headingPairs()],
      [toggle.id]: [
        todo('The nucleus', false),
        todo('The mitochondria', true),
        todo('The ribosome', false),
        todo('The lysosome', false),
      ],
    });
    const handler = makeHandler(api, new CardOption({ 'mcq-enabled': 'true' }));

    const decks = await handler.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const cards = decks.flatMap((deck) => deck.cards);
    expect(cards).toHaveLength(1);
    expect(cards[0].isValidMCQNote()).toBe(true);
    expect(handler.inducedRule).toBeUndefined();
  });
});
