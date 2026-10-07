import { vi } from 'vitest';
import {
  AudioBlockObjectResponse,
  ImageBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import Note from '../../../lib/parser/Note';
import ParserRules from '../../../lib/parser/ParserRules';
import CardOption from '../../../lib/parser/Settings/CardOption';
import Workspace from '../../../lib/parser/WorkSpace';
import { setupTests } from '../../../test/configure-jest';
import MockNotionAPI from '../_mock/MockNotionAPI';
import BlockHandler from './BlockHandler';

vi.mock('../helpers/isTesting', () => ({
  __esModule: true,
  default: vi.fn(() => false),
}));

vi.mock('../helpers/downloadMediaOrSkip', () => ({
  __esModule: true,
  downloadMediaOrSkip: vi.fn(async () => Buffer.from('fake-media-bytes')),
}));

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

function buildToggleBlock(
  id: string,
  rich_text: ReturnType<typeof richText>[]
) {
  return {
    object: 'block' as const,
    id,
    parent: { type: 'page_id' as const, page_id: 'page-id' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user' as const, id: 'user-id' },
    last_edited_by: { object: 'user' as const, id: 'user-id' },
    has_children: true,
    archived: false,
    in_trash: false,
    type: 'toggle' as const,
    toggle: { rich_text, color: 'default' as const },
  };
}

function imageChild(id: string, url: string): ImageBlockObjectResponse {
  return {
    object: 'block',
    id,
    parent: { type: 'block_id', block_id: 'parent-toggle' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'user-id' },
    last_edited_by: { object: 'user', id: 'user-id' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'image',
    image: { type: 'file', file: { url, expiry_time: '' }, caption: [] },
  } as unknown as ImageBlockObjectResponse;
}

function audioChild(id: string, url: string): AudioBlockObjectResponse {
  return {
    object: 'block',
    id,
    parent: { type: 'block_id', block_id: 'parent-toggle' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'user-id' },
    last_edited_by: { object: 'user', id: 'user-id' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'audio',
    audio: { type: 'file', file: { url, expiry_time: '' }, caption: [] },
  } as unknown as AudioBlockObjectResponse;
}

class ChildStubApi extends MockNotionAPI {
  constructor(
    private readonly toggleId: string,
    private readonly children: unknown[]
  ) {
    super(process.env.NOTION_KEY!, '3');
  }

  async getBlocks(
    params: Parameters<MockNotionAPI['getBlocks']>[0]
  ): ReturnType<MockNotionAPI['getBlocks']> {
    if (params.id === this.toggleId) {
      return {
        type: 'block',
        block: {},
        object: 'list',
        next_cursor: null,
        has_more: false,
        results: this.children,
      } as Awaited<ReturnType<MockNotionAPI['getBlocks']>>;
    }
    return {
      type: 'block',
      block: {},
      object: 'list',
      next_cursor: null,
      has_more: false,
      results: [],
    } as Awaited<ReturnType<MockNotionAPI['getBlocks']>>;
  }
}

async function runToggle(
  toggleId: string,
  children: unknown[]
): Promise<Note[]> {
  const api = new ChildStubApi(toggleId, children);
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  const bl = new BlockHandler(exporter, api, new CardOption({}));
  return bl.getFlashcards(
    new ParserRules(),
    [buildToggleBlock(toggleId, [])],
    [],
    undefined
  );
}

beforeEach(() => setupTests());

describe('toggle front media when summary is empty', () => {
  test('image-only toggle renders the image as the card front, bundled as media', async () => {
    const cards = await runToggle('img-toggle', [
      imageChild('img-child', 'https://example.com/ultrasound.png'),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toMatch(/<img src="[^"]+\.png" \/>/);
    expect(cards[0].name).not.toContain('https://example.com');
  });

  test('audio-first toggle renders [sound:…] on the front, bundled as media', async () => {
    const cards = await runToggle('audio-toggle', [
      audioChild('audio-child', 'https://example.com/heartbeat.mp3'),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toMatch(/\[sound:[^\]]+\]/);
    expect(cards[0].name).not.toContain('https://example.com');
  });

  test('empty summary with non-media first child produces no front and is skipped', async () => {
    const cards = await runToggle('text-toggle', [
      {
        object: 'block',
        id: 'para-child',
        parent: { type: 'block_id', block_id: 'parent-toggle' },
        created_time: '',
        last_edited_time: '',
        created_by: { object: 'user', id: 'user-id' },
        last_edited_by: { object: 'user', id: 'user-id' },
        has_children: false,
        archived: false,
        in_trash: false,
        type: 'paragraph',
        paragraph: { rich_text: [richText('just text')], color: 'default' },
      },
    ]);

    expect(cards).toHaveLength(0);
  });
});
