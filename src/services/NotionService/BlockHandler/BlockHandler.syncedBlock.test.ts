import { vi } from 'vitest';
import BlockHandler from './BlockHandler';
import CardOption from '../../../lib/parser/Settings/CardOption';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import ParserRules from '../../../lib/parser/ParserRules';
import Workspace from '../../../lib/parser/WorkSpace';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { setupTests } from '../../../test/configure-jest';

beforeEach(() => setupTests());

const baseBlockShape = {
  object: 'block' as const,
  created_time: '2026-05-20T00:00:00.000Z',
  last_edited_time: '2026-05-20T00:00:00.000Z',
  created_by: { object: 'user' as const, id: 'user-1' },
  last_edited_by: { object: 'user' as const, id: 'user-1' },
  has_children: false,
  archived: false,
  in_trash: false,
  parent: { type: 'page_id' as const, page_id: 'page-1' },
};

function richText(text: string) {
  return [
    {
      type: 'text' as const,
      text: { content: text, link: null },
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default' as const,
      },
      plain_text: text,
      href: null,
    },
  ];
}

function makeToggle(id: string, frontText: string) {
  return {
    ...baseBlockShape,
    id,
    type: 'toggle' as const,
    has_children: true,
    toggle: { rich_text: richText(frontText), color: 'default' as const },
  };
}

function makeParagraph(id: string, text: string) {
  return {
    ...baseBlockShape,
    id,
    type: 'paragraph' as const,
    paragraph: { rich_text: richText(text), color: 'default' as const },
  };
}

function makeSyncedBlock(id: string, syncedFromBlockId: string | null) {
  return {
    ...baseBlockShape,
    id,
    type: 'synced_block' as const,
    has_children: true,
    synced_block: {
      synced_from:
        syncedFromBlockId == null
          ? null
          : { type: 'block_id' as const, block_id: syncedFromBlockId },
    },
  };
}

interface ResponseMap {
  [id: string]: unknown[];
}

function makeApi(responseMap: ResponseMap): NotionAPIWrapper {
  return {
    getPage: vi.fn().mockResolvedValue({
      id: 'page-1',
      object: 'page',
      properties: {
        title: {
          id: 'title',
          type: 'title',
          title: richText('Synced Toggle Page'),
        },
      },
      created_time: '2026-05-20T00:00:00.000Z',
      last_edited_time: '2026-05-20T00:00:00.000Z',
      parent: { type: 'workspace', workspace: true },
      icon: null,
      cover: null,
      archived: false,
      in_trash: false,
      url: 'https://www.notion.so/page-1',
    }),
    getPageTitle: vi.fn().mockResolvedValue('Synced Toggle Page'),
    getTopLevelTags: vi.fn().mockResolvedValue([]),
    getBlocks: vi.fn(async ({ id }: { id: string }) => ({
      type: 'block' as const,
      block: {},
      object: 'list' as const,
      next_cursor: null,
      has_more: false,
      results: responseMap[id] ?? [],
    })),
  } as unknown as NotionAPIWrapper;
}

function makeHandler(api: NotionAPIWrapper): BlockHandler {
  const settings = new CardOption({});
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  return new BlockHandler(exporter, api, settings);
}

describe('BlockHandler — linked toggle blocks (synced_block)', () => {
  it('converts a toggle wrapped in an original synced_block (synced_from=null) at page level', async () => {
    const childToggle = makeToggle('toggle-inside', 'What is a linked toggle?');
    const toggleBack = makeParagraph(
      'para-1',
      'A toggle inside a synced block.'
    );
    const original = makeSyncedBlock('synced-orig', null);

    const api = makeApi({
      'page-1': [original],
      'synced-orig': [childToggle],
      'toggle-inside': [toggleBack],
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    expect(decks.length).toBeGreaterThan(0);
    const allCards = decks.flatMap((d) => d.cards);
    expect(allCards.map((c) => c.name)).toContain('What is a linked toggle?');
  });

  it('converts a toggle reached through a reference synced_block at page level', async () => {
    const sourceToggle = makeToggle('toggle-src', 'Authored once, linked many');
    const toggleBack = makeParagraph(
      'para-back',
      'Linked toggles share content.'
    );
    const reference = makeSyncedBlock('synced-ref', 'source-block-id');

    const api = makeApi({
      'page-1': [reference],
      'source-block-id': [sourceToggle],
      'toggle-src': [toggleBack],
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const allCards = decks.flatMap((d) => d.cards);
    expect(allCards.map((c) => c.name)).toContain('Authored once, linked many');
  });

  it('does not regress: a plain toggle on the page still converts', async () => {
    const plainToggle = makeToggle('plain-1', 'Plain toggle survives');
    const toggleBack = makeParagraph('plain-back', 'Hello.');

    const api = makeApi({
      'page-1': [plainToggle],
      'plain-1': [toggleBack],
    });
    const bl = makeHandler(api);

    const decks = await bl.findFlashcards({
      parentType: 'page',
      topLevelId: 'page-1',
      rules: new ParserRules(),
      decks: [],
      parentName: '',
    });

    const allCards = decks.flatMap((d) => d.cards);
    expect(allCards.map((c) => c.name)).toContain('Plain toggle survives');
  });
});
