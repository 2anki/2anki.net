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

const locator = () => ({
  parentType: 'page' as const,
  topLevelId: 'page-1',
  rules: new ParserRules(),
  decks: [],
  parentName: '',
});

const threeLevels = {
  'page-1': [textBlock('t-1', 'toggle', 'Level one', true)],
  't-1': [
    textBlock('p-1', 'paragraph', 'Answer one'),
    textBlock('t-2', 'toggle', 'Level two', true),
  ],
  't-2': [
    textBlock('p-2', 'paragraph', 'Answer two'),
    textBlock('t-3', 'toggle', 'Level three', true),
  ],
  't-3': [textBlock('p-3', 'paragraph', 'Answer three')],
};

describe('promote-nested-toggles on the Notion API path', () => {
  it('keeps one card per top-level toggle when the option is off', async () => {
    const handler = makeHandler(makeApi(threeLevels));

    const decks = await handler.findFlashcards(locator());

    expect(decks[0].cards).toHaveLength(1);
    expect(decks[0].cards[0].name).toContain('Level one');
  });

  it('makes every nested toggle its own card when the option is on', async () => {
    const handler = makeHandler(
      makeApi(threeLevels),
      new CardOption({ 'promote-nested-toggles': 'true' })
    );

    const decks = await handler.findFlashcards(locator());

    const cards = decks[0].cards;
    expect(cards.map((c) => stripTags(c.name))).toEqual([
      'Level one',
      'Level two',
      'Level three',
    ]);
    expect(cards[1].back).toContain('Answer two');
    expect(cards[2].back).toContain('Answer three');
    expect(cards[1].notionId).toBe('t-2');
    expect(cards.map((c) => c.number)).toEqual([0, 1, 2]);
  });

  it('keeps the nested toggles in the parent back', async () => {
    const handler = makeHandler(
      makeApi(threeLevels),
      new CardOption({ 'promote-nested-toggles': 'true' })
    );

    const decks = await handler.findFlashcards(locator());

    expect(decks[0].cards[0].back).toContain('Level two');
  });

  it('skips a nested toggle with nothing inside it', async () => {
    const handler = makeHandler(
      makeApi({
        'page-1': [textBlock('t-1', 'toggle', 'Parent', true)],
        't-1': [
          textBlock('p-1', 'paragraph', 'Parent answer'),
          textBlock('t-2', 'toggle', 'Empty nested', false),
        ],
      }),
      new CardOption({ 'promote-nested-toggles': 'true' })
    );

    const decks = await handler.findFlashcards(locator());

    expect(decks[0].cards).toHaveLength(1);
  });

  it('adds nothing under cherry-pick', async () => {
    const handler = makeHandler(
      makeApi(threeLevels),
      new CardOption({
        'promote-nested-toggles': 'true',
        cherry: 'true',
      })
    );

    const decks = await handler.findFlashcards(locator());

    expect(decks[0].cards).toHaveLength(0);
  });

  it('swaps front and back of nested cards when reversed is on', async () => {
    const handler = makeHandler(
      makeApi(threeLevels),
      new CardOption({ 'promote-nested-toggles': 'true', reversed: 'true' })
    );

    const decks = await handler.findFlashcards(locator());

    const second = decks[0].cards[1];
    expect(stripTags(second.name)).toContain('Answer two');
    expect(stripTags(second.back)).toBe('Level two');
  });

  it('adds a reversed copy of nested cards with basic reversed on', async () => {
    const handler = makeHandler(
      makeApi(threeLevels),
      new CardOption({
        'promote-nested-toggles': 'true',
        'basic-reversed': 'true',
      })
    );

    const decks = await handler.findFlashcards(locator());

    expect(decks[0].cards).toHaveLength(6);
  });

  it('stops promoting below the depth cap', async () => {
    const levels: Record<string, unknown[]> = {
      'page-1': [textBlock('t-1', 'toggle', 'L1', true)],
    };
    for (let i = 1; i <= 6; i += 1) {
      levels[`t-${i}`] = [
        textBlock(`p-${i}`, 'paragraph', `Answer ${i}`),
        textBlock(`t-${i + 1}`, 'toggle', `L${i + 1}`, true),
      ];
    }
    levels['t-7'] = [textBlock('p-7', 'paragraph', 'Answer 7')];
    const handler = makeHandler(
      makeApi(levels),
      new CardOption({ 'promote-nested-toggles': 'true' })
    );

    const decks = await handler.findFlashcards(locator());

    expect(decks[0].cards.map((c) => stripTags(c.name))).toEqual([
      'L1',
      'L2',
      'L3',
      'L4',
    ]);
  });
});
