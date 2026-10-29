import { vi } from 'vitest';
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

function emptyParagraph(id: string) {
  return {
    ...textBlock(id, 'paragraph', ''),
    paragraph: { rich_text: [], color: 'default' },
  };
}

const page = {
  'page-1': [
    textBlock('t-1', 'toggle', 'Has an answer', true),
    textBlock('t-2', 'toggle', 'Only an empty line inside', true),
    textBlock('t-3', 'toggle', 'Only spaces inside', true),
  ],
  't-1': [textBlock('p-1', 'paragraph', 'Answer one')],
  't-2': [emptyParagraph('p-2')],
  't-3': [textBlock('p-3', 'paragraph', '   ')],
};

describe('a toggle whose answer is only empty blocks on the Notion API path', () => {
  it('leaves it out of the deck instead of shipping a blank back', async () => {
    const handler = makeHandler(makeApi(page));

    const decks = await handler.findFlashcards(locator());

    expect(decks[0].cards.map((card) => stripTags(card.name))).toEqual([
      'Has an answer',
    ]);
  });

  it('counts it as an empty back so the deck says why it is missing', async () => {
    const handler = makeHandler(makeApi(page));

    await handler.findFlashcards(locator());

    expect(handler.emptyBackCount).toBe(2);
  });
});

describe('a Notion page where every toggle answer is empty', () => {
  const allBlank = {
    'page-1': [
      textBlock('t-1', 'toggle', 'Only an empty line inside', true),
      textBlock('t-2', 'toggle', 'Nothing inside at all', true),
    ],
    't-1': [emptyParagraph('p-1')],
  };

  it('makes no cards and says the answers are missing', async () => {
    const handler = makeHandler(makeApi(allBlank));

    const decks = await handler.findFlashcards(locator());

    expect(decks.flatMap((deck) => deck.cards)).toEqual([]);
    expect(handler.emptyDeckReason()).toBe('empty_answers');
  });
});

describe('blank toggle answers with the Notion reversal options', () => {
  it('drops and counts them when the deck is reversed', async () => {
    const handler = makeHandler(
      makeApi(page),
      new CardOption({ reversed: 'true' })
    );

    const decks = await handler.findFlashcards(locator());

    expect(decks[0].cards.map((card) => stripTags(card.name))).toEqual([
      'Answer one',
    ]);
    expect(handler.emptyBackCount).toBe(2);
  });

  it('says the answers are missing on a reversed page where every answer is blank', async () => {
    const handler = makeHandler(
      makeApi({
        'page-1': [
          textBlock('t-1', 'toggle', 'Only an empty line inside', true),
        ],
        't-1': [emptyParagraph('p-1')],
      }),
      new CardOption({ reversed: 'true' })
    );

    await handler.findFlashcards(locator());

    expect(handler.emptyDeckReason()).toBe('empty_answers');
  });

  it('keeps neither the card nor its mirror with basic and reversed on', async () => {
    const handler = makeHandler(
      makeApi(page),
      new CardOption({ 'basic-reversed': 'true' })
    );

    const decks = await handler.findFlashcards(locator());

    expect(decks[0].cards.map((card) => stripTags(card.name))).toEqual([
      'Has an answer',
      'Answer one',
    ]);
  });
});
