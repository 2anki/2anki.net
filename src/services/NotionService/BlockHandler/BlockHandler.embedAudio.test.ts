import { vi, type MockInstance } from 'vitest';
import { AudioBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { setupTests } from '../../../test/configure-jest';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import Workspace from '../../../lib/parser/WorkSpace';
import CardOption from '../../../lib/parser/Settings/CardOption';
import BlockHandler from './BlockHandler';
import NotionAPIWrapper from '../NotionAPIWrapper';

beforeEach(() => setupTests());

vi.mock('../helpers/isTesting', () => ({
  __esModule: true,
  default: vi.fn(() => false),
}));

vi.mock('../helpers/downloadMediaOrSkip', () => ({
  __esModule: true,
  downloadMediaOrSkip: vi.fn(async () => Buffer.from('fake-audio-bytes')),
}));

const fakeApi = {
  getBlock: vi.fn(),
} as unknown as NotionAPIWrapper;

function makeExternalAudioBlock(url: string): AudioBlockObjectResponse {
  return {
    object: 'block',
    id: 'audio-1',
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'audio',
    audio: {
      type: 'external',
      external: { url },
      caption: [],
    },
  } as unknown as AudioBlockObjectResponse;
}

function makeFileAudioBlock(url: string): AudioBlockObjectResponse {
  return {
    object: 'block',
    id: 'audio-file-1',
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'audio',
    audio: {
      type: 'file',
      file: { url, expiry_time: '' },
      caption: [],
    },
  } as unknown as AudioBlockObjectResponse;
}

describe('BlockHandler.embedAudioFile extension', () => {
  let exporter: CustomExporter;
  let addMediaSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    const ws = new Workspace(true, 'fs');
    exporter = new CustomExporter('', ws.location);
    addMediaSpy = vi
      .spyOn(exporter, 'addMedia')
      .mockImplementation(() => 'fake-abs-path');
  });

  test('keeps the m4a extension from the URL path so Anki can play it', async () => {
    const handler = new BlockHandler(exporter, fakeApi, new CardOption({}));

    const result = await handler.embedAudioFile(
      makeExternalAudioBlock('https://example.com/voice-memo.m4a')
    );

    expect(result).toMatch(/^\[sound:[^\]]+\.m4a\]$/);
    expect(addMediaSpy.mock.calls[0][0]).toMatch(/\.m4a$/);
  });

  test('keeps the extension from a signed URL that carries a query string', async () => {
    const handler = new BlockHandler(exporter, fakeApi, new CardOption({}));

    const result = await handler.embedAudioFile(
      makeExternalAudioBlock(
        'https://prod-files.notion.so/clip.webm?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600'
      )
    );

    expect(result).toMatch(/^\[sound:[^\]]+\.webm\]$/);
    expect(addMediaSpy.mock.calls[0][0]).toMatch(/\.webm$/);
  });

  test('keeps the extension from a type:file Notion signed URL', async () => {
    const handler = new BlockHandler(exporter, fakeApi, new CardOption({}));

    const result = await handler.embedAudioFile(
      makeFileAudioBlock(
        'https://prod-files-secure.s3.us-west-2.amazonaws.com/workspace/Voice-Note.m4a?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600'
      )
    );

    expect(result).toMatch(/^\[sound:[^\]]+\.m4a\]$/);
    expect(addMediaSpy.mock.calls[0][0]).toMatch(/\.m4a$/);
  });

  test('falls back to mp3 when the URL path has no audio extension', async () => {
    const handler = new BlockHandler(exporter, fakeApi, new CardOption({}));

    const result = await handler.embedAudioFile(
      makeExternalAudioBlock('https://example.com/attachment/download')
    );

    expect(result).toMatch(/^\[sound:[^\]]+\.mp3\]$/);
    expect(addMediaSpy.mock.calls[0][0]).toMatch(/\.mp3$/);
  });
});
