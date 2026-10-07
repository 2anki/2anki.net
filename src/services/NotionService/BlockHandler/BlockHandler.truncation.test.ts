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
