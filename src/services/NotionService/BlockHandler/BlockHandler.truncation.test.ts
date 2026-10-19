import { vi } from 'vitest';
import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { setupTests } from '../../../test/configure-jest';

beforeEach(() => setupTests());

function paragraphBlock(id: string) {
  return {
    object: 'block',
    id,
    type: 'paragraph',
    paragraph: { rich_text: [], color: 'default' },
    has_children: false,
    created_time: '2026-06-01T00:00:00.000Z',
    last_edited_time: '2026-06-01T00:00:00.000Z',
  };
}

function makePageApi(hasMore: boolean): NotionAPIWrapper {
  return {
    getPage: vi.fn().mockResolvedValue({
      object: 'page',
      id: 'page-1',
      created_time: '2026-06-01T00:00:00.000Z',
      last_edited_time: '2026-06-01T00:00:00.000Z',
    }),
    getPageTitle: vi.fn().mockResolvedValue('Long Page'),
    getTopLevelTags: vi.fn().mockResolvedValue([]),
    getBlocks: vi.fn().mockResolvedValue({
      object: 'list',
      type: 'block',
      block: {},
      results: [paragraphBlock('b1'), paragraphBlock('b2')],
      next_cursor: hasMore ? 'cursor-1' : null,
      has_more: hasMore,
    }),
  } as unknown as NotionAPIWrapper;
}

const defaultAnnotations = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: 'default' as const,
};

function richText(content: string) {
  return {
    type: 'text' as const,
    text: { content, link: null },
    annotations: { ...defaultAnnotations },
    plain_text: content,
    href: null,
  };
}

function toggleBlock(id: string, summary: string) {
  return {
    object: 'block' as const,
    id,
    parent: { type: 'page_id' as const, page_id: 'page-1' },
    created_time: '2026-06-01T00:00:00.000Z',
    last_edited_time: '2026-06-01T00:00:00.000Z',
    created_by: { object: 'user' as const, id: 'user-id' },
    last_edited_by: { object: 'user' as const, id: 'user-id' },
    has_children: true,
    archived: false,
    in_trash: false,
    type: 'toggle' as const,
    toggle: { rich_text: [richText(summary)], color: 'default' as const },
  };
}

function makeChildApi(hasMore: boolean): NotionAPIWrapper {
  return {
    getBlocks: vi.fn().mockResolvedValue({
      object: 'list',
      type: 'block',
      block: {},
      results: [paragraphBlock('c1')],
      next_cursor: hasMore ? 'cursor-child' : null,
      has_more: hasMore,
    }),
  } as unknown as NotionAPIWrapper;
}

function makeHandler(api: NotionAPIWrapper, useAll: boolean): BlockHandler {
  const settings = new CardOption({});
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  const handler = new BlockHandler(exporter, api, settings);
  handler.useAll = useAll;
  return handler;
}

async function convertPage(handler: BlockHandler, rules: ParserRules) {
  return handler.findFlashcardsFromPage({
    parentType: 'page',
    topLevelId: 'page-1',
    rules,
    decks: [],
    parentName: '',
  });
}

describe('BlockHandler truncation accumulation', () => {
  it('records truncation when a free fetch has more blocks left', async () => {
    const handler = makeHandler(makePageApi(true), false);

    await convertPage(handler, new ParserRules());

    expect(handler.truncation).toEqual({
      blocksConverted: 2,
      subDeckRulesSkipped: false,
    });
  });

  it('flags skipped sub-deck rules when rule-based sub-decks are configured', async () => {
    const handler = makeHandler(makePageApi(true), false);
    const rules = new ParserRules();
    rules.SUB_DECKS = ['child_page', 'toggle'];

    await convertPage(handler, rules);

    expect(handler.truncation).toEqual({
      blocksConverted: 2,
      subDeckRulesSkipped: true,
    });
  });

  it('records nothing when the page fits in the free window', async () => {
    const handler = makeHandler(makePageApi(false), false);

    await convertPage(handler, new ParserRules());

    expect(handler.truncation).toBeUndefined();
  });

  it('records nothing on the paid path even when has_more stays true', async () => {
    const handler = makeHandler(makePageApi(true), true);

    await convertPage(handler, new ParserRules());

    expect(handler.truncation).toBeUndefined();
  });
});

describe('BlockHandler nested truncation', () => {
  it('flags truncation when a toggle back-side fetch is cut short on the free plan', async () => {
    const handler = makeHandler(makeChildApi(true), false);

    await handler.getFlashcards(
      new ParserRules(),
      [toggleBlock('toggle-1', 'Front')],
      [],
      undefined
    );

    expect(handler.truncation).toEqual({
      blocksConverted: 0,
      subDeckRulesSkipped: false,
    });
  });

  it('does not flag nested truncation on the paid path', async () => {
    const handler = makeHandler(makeChildApi(true), true);

    await handler.getFlashcards(
      new ParserRules(),
      [toggleBlock('toggle-1', 'Front')],
      [],
      undefined
    );

    expect(handler.truncation).toBeUndefined();
  });

  it('does not flag nested truncation when the back-side fits in the free window', async () => {
    const handler = makeHandler(makeChildApi(false), false);

    await handler.getFlashcards(
      new ParserRules(),
      [toggleBlock('toggle-1', 'Front')],
      [],
      undefined
    );

    expect(handler.truncation).toBeUndefined();
  });

  it('leaves the page block count unchanged when a nested fetch truncates after the page did', async () => {
    const api = {
      getPage: vi.fn().mockResolvedValue({
        object: 'page',
        id: 'page-1',
        created_time: '2026-06-01T00:00:00.000Z',
        last_edited_time: '2026-06-01T00:00:00.000Z',
      }),
      getPageTitle: vi.fn().mockResolvedValue('Long Page'),
      getTopLevelTags: vi.fn().mockResolvedValue([]),
      getBlocks: vi.fn().mockImplementation(({ id }: { id: string }) => {
        if (id === 'page-1') {
          return Promise.resolve({
            object: 'list',
            type: 'block',
            block: {},
            results: [
              toggleBlock('toggle-1', 'Front'),
              paragraphBlock('b2'),
              paragraphBlock('b3'),
            ],
            next_cursor: 'cursor-page',
            has_more: true,
          });
        }
        return Promise.resolve({
          object: 'list',
          type: 'block',
          block: {},
          results: [paragraphBlock('c1')],
          next_cursor: id === 'toggle-1' ? 'cursor-child' : null,
          has_more: id === 'toggle-1',
        });
      }),
    } as unknown as NotionAPIWrapper;
    const handler = makeHandler(api, false);

    await convertPage(handler, new ParserRules());

    expect(handler.truncation).toEqual({
      blocksConverted: 3,
      subDeckRulesSkipped: false,
    });
  });
});
