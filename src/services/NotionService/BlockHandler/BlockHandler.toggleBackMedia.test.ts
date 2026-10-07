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

function buildToggleBlock(id: string, summary: string) {
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
    toggle: { rich_text: [richText(summary)], color: 'default' as const },
  };
}

function imageChild(
  id: string,
  source: 'file' | 'external',
  url: string
): ImageBlockObjectResponse {
  const image =
    source === 'file'
      ? { type: 'file', file: { url, expiry_time: '' }, caption: [] }
      : { type: 'external', external: { url }, caption: [] };
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
    image,
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
    const results = params.id === this.toggleId ? this.children : [];
    return {
      type: 'block',
      block: {},
      object: 'list',
      next_cursor: null,
      has_more: false,
      results,
    } as Awaited<ReturnType<MockNotionAPI['getBlocks']>>;
  }
}

async function runToggle(
  toggleId: string,
  summary: string,
  children: unknown[]
): Promise<Note[]> {
  const api = new ChildStubApi(toggleId, children);
  const exporter = new CustomExporter('', new Workspace(true, 'fs').location);
  const bl = new BlockHandler(exporter, api, new CardOption({}));
  return bl.getFlashcards(
    new ParserRules(),
    [buildToggleBlock(toggleId, summary)],
    [],
    undefined
  );
}

beforeEach(() => setupTests());

describe('toggle back-side media bundles instead of leaking a raw URL', () => {
  test('file-type image inside a toggle body is bundled as media, not the signed URL', async () => {
    const cards = await runToggle('img-toggle', 'Front', [
      imageChild(
        'img-child',
        'file',
        'https://prod-files-secure.s3.us-west-2.amazonaws.com/ultrasound.png?sig=abc'
      ),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0].back).toMatch(/<img src="[^"]+\.png" \/>/);
    expect(cards[0].back).not.toContain('prod-files-secure.s3');
    expect(cards[0].back).not.toContain('sig=abc');
  });

  test('file-type audio inside a toggle body is a bundled [sound:] tag, not a link', async () => {
    const cards = await runToggle('audio-toggle', 'Listen', [
      audioChild(
        'audio-child',
        'https://prod-files-secure.s3.us-west-2.amazonaws.com/heartbeat.mp3?sig=xyz'
      ),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0].back).toMatch(/\[sound:[^\]]+\]/);
    expect(cards[0].back).not.toContain('prod-files-secure.s3');
    expect(cards[0].back).not.toContain('<a ');
  });

  test('external-type image inside a toggle body still renders as an img', async () => {
    const cards = await runToggle('ext-toggle', 'Diagram', [
      imageChild('ext-child', 'external', 'https://example.com/diagram.png'),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0].back).toMatch(/<img src="[^"]+" \/>/);
  });
});
