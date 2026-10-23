import { vi, type MockInstance } from 'vitest';
import { VideoBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { setupTests } from '../../../test/configure-jest';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import Workspace from '../../../lib/parser/WorkSpace';
import CardOption from '../../../lib/parser/Settings/CardOption';
import BlockHandler from './BlockHandler';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { BlockVideo } from '../blocks/media/BlockVideo';
import { downloadMediaOrSkip } from '../helpers/downloadMediaOrSkip';

beforeEach(() => setupTests());

vi.mock('../helpers/isTesting', () => ({
  __esModule: true,
  default: vi.fn(() => false),
}));

vi.mock('../helpers/downloadMediaOrSkip', () => ({
  __esModule: true,
  downloadMediaOrSkip: vi.fn(async () => Buffer.from('fake-video-bytes')),
}));

const fakeApi = { getBlock: vi.fn() } as unknown as NotionAPIWrapper;

const SIGNED_URL =
  'https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/abc/clip.webm?X-Amz-Expires=3600&X-Amz-Signature=sig';

function makeVideoBlock(
  video: Record<string, unknown>
): VideoBlockObjectResponse {
  return {
    object: 'block',
    id: 'video-1',
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'video',
    video: { caption: [], ...video },
  } as unknown as VideoBlockObjectResponse;
}

const fileVideo = () =>
  makeVideoBlock({ type: 'file', file: { url: SIGNED_URL, expiry_time: '' } });

describe('uploaded Notion videos', () => {
  let exporter: CustomExporter;
  let addMediaSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    exporter = new CustomExporter('', new Workspace(true, 'fs').location);
    addMediaSpy = vi
      .spyOn(exporter, 'addMedia')
      .mockImplementation(() => 'fake-abs-path');
  });

  test('is bundled in the deck and played from the file, not from the expiring link', async () => {
    const handler = new BlockHandler(exporter, fakeApi, new CardOption({}));

    const html = await BlockVideo(fileVideo(), handler);

    expect(html).toMatch(/^<video controls src="[^"]+\.webm"><\/video>$/);
    expect(html).not.toContain('prod-files-secure');
    expect(addMediaSpy).toHaveBeenCalledTimes(1);
    expect(addMediaSpy.mock.calls[0][0]).toMatch(/\.webm$/);
  });

  test('counts a video that cannot be downloaded instead of leaving a dead link', async () => {
    vi.mocked(downloadMediaOrSkip).mockResolvedValueOnce(null);
    const handler = new BlockHandler(exporter, fakeApi, new CardOption({}));

    const html = await BlockVideo(fileVideo(), handler);

    expect(html).toBe('');
    expect(handler.droppedFileAssetCount).toBe(1);
  });

  test('keeps a YouTube link as an embed', async () => {
    const handler = new BlockHandler(exporter, fakeApi, new CardOption({}));
    const html = await BlockVideo(
      makeVideoBlock({
        type: 'external',
        external: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      }),
      handler
    );

    expect(html).toContain('<iframe');
    expect(html).toContain('youtube.com/embed/dQw4w9WgXcQ');
    expect(addMediaSpy).not.toHaveBeenCalled();
  });
});
