import { vi, type Mock, type Mocked } from 'vitest';
import axios from 'axios';
import dns from 'dns';
import { BookmarkBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';

import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import Note from '../../../lib/parser/Note';
import ParserRules from '../../../lib/parser/ParserRules';
import CardOption from '../../../lib/parser/Settings/CardOption';
import Workspace from '../../../lib/parser/WorkSpace';
import { setupTests } from '../../../test/configure-jest';
import MockNotionAPI from '../_mock/MockNotionAPI';
import BlockHandler from './BlockHandler';

vi.mock('axios', async () => {
  const actual = await vi.importActual<typeof import('axios')>('axios');
  return {
    __esModule: true,
    default: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      isAxiosError: actual.isAxiosError,
    },
  };
});

vi.mock('dns', () => ({
  __esModule: true,
  default: { promises: { lookup: vi.fn() } },
  promises: { lookup: vi.fn() },
}));

vi.mock('../helpers/isTesting', () => ({
  __esModule: true,
  default: vi.fn(() => false),
}));

const mockedAxios = axios as Mocked<typeof axios>;
const mockedLookup = dns.promises.lookup as Mock;

const UNRECOGNISED_TLD_URL = 'https://notes.example.test/page';

const blockBase = {
  object: 'block' as const,
  created_time: '',
  last_edited_time: '',
  created_by: { object: 'user' as const, id: 'user-id' },
  last_edited_by: { object: 'user' as const, id: 'user-id' },
  archived: false,
  in_trash: false,
};

function bookmarkBlock(id: string, url: string): BookmarkBlockObjectResponse {
  return {
    ...blockBase,
    id,
    parent: { type: 'block_id', block_id: 'toggle-with-bookmark' },
    has_children: false,
    type: 'bookmark',
    bookmark: { url, caption: [] },
  } as unknown as BookmarkBlockObjectResponse;
}

function toggleBlock(id: string, summary: string) {
  return {
    ...blockBase,
    id,
    parent: { type: 'page_id' as const, page_id: 'page-id' },
    has_children: true,
    type: 'toggle' as const,
    toggle: {
      rich_text: [
        {
          type: 'text' as const,
          text: { content: summary, link: null },
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: 'default' as const,
          },
          plain_text: summary,
          href: null,
        },
      ],
      color: 'default' as const,
    },
  };
}

class ChildStubApi extends MockNotionAPI {
  constructor(private readonly children: Map<string, unknown[]>) {
    super(process.env.NOTION_KEY!, '3');
  }

  async getBlocks(
    params: Parameters<MockNotionAPI['getBlocks']>[0]
  ): ReturnType<MockNotionAPI['getBlocks']> {
    return {
      type: 'block',
      block: {},
      object: 'list',
      next_cursor: null,
      has_more: false,
      results: this.children.get(params.id) ?? [],
    } as Awaited<ReturnType<MockNotionAPI['getBlocks']>>;
  }
}

const convert = (
  blocks: unknown[],
  children: Map<string, unknown[]> = new Map()
): Promise<Note[]> => {
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  const handler = new BlockHandler(
    exporter,
    new ChildStubApi(children),
    new CardOption({})
  );
  return handler.getFlashcards(
    new ParserRules(),
    blocks as Parameters<BlockHandler['getFlashcards']>[1],
    [],
    undefined
  );
};

beforeEach(() => {
  setupTests();
  vi.clearAllMocks();
  mockedLookup.mockResolvedValue([{ address: '13.224.0.1', family: 4 }]);
  mockedAxios.get.mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'text/html' },
    data: '<html><head><title>Lecture notes</title></head></html>',
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a bookmark whose URL the scraper rejects', () => {
  it('renders its hostname fallback on a card front and the conversion completes', async () => {
    const cards = await convert([
      bookmarkBlock('front-bookmark', UNRECOGNISED_TLD_URL),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain(
      '<div class="bookmark-title">notes.example.test</div>'
    );
    expect(cards[0].name).toContain(`href="${UNRECOGNISED_TLD_URL}"`);
  });

  it('renders its hostname fallback on a card back and the conversion completes', async () => {
    const cards = await convert(
      [toggleBlock('toggle-with-bookmark', 'Reading')],
      new Map([
        [
          'toggle-with-bookmark',
          [bookmarkBlock('back-bookmark', UNRECOGNISED_TLD_URL)],
        ],
      ])
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain('Reading');
    expect(cards[0].back).toContain(
      '<div class="bookmark-title">notes.example.test</div>'
    );
    expect(cards[0].back).toContain(`href="${UNRECOGNISED_TLD_URL}"`);
  });
});
