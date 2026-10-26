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

const page = {
  'page-1': [
    textBlock('t-1', 'toggle', '🍒 Marked question', true),
    textBlock('t-2', 'toggle', 'Plain question one', true),
    textBlock('t-3', 'toggle', 'Plain question two', true),
  ],
  't-1': [textBlock('p-1', 'paragraph', 'Answer one')],
  't-2': [textBlock('p-2', 'paragraph', 'Answer two')],
  't-3': [textBlock('p-3', 'paragraph', 'Answer three')],
};

describe('cherry-pick accounting on the Notion API path', () => {
  it('counts every toggle it left out', async () => {
    const handler = makeHandler(
      makeApi(page),
      new CardOption({ cherry: 'true' })
    );

    const decks = await handler.findFlashcards(locator());

    expect(decks[0].cards).toHaveLength(1);
    expect(handler.cherrySkippedCount).toBe(2);
  });

  it('counts nothing when cherry-pick is off', async () => {
    const handler = makeHandler(makeApi(page));

    const decks = await handler.findFlashcards(locator());

    expect(decks[0].cards).toHaveLength(3);
    expect(handler.cherrySkippedCount).toBe(0);
  });
});
