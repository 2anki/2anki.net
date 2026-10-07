import { vi, type MockInstance } from 'vitest';
import { ImageBlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
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
  downloadMediaOrSkip: vi.fn(async () => Buffer.from('fake-image-bytes')),
}));

const fakeApi = {
  getBlocks: vi.fn(),
} as unknown as NotionAPIWrapper;

function makeImageBlock(url: string): ImageBlockObjectResponse {
  return {
    object: 'block',
    id: 'img-1',
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'image',
    image: {
      type: 'external',
      external: { url },
      caption: [],
    },
  } as unknown as ImageBlockObjectResponse;
}

describe('BlockHandler.embedImage embed-images gate', () => {
  let exporter: CustomExporter;
  let addMediaSpy: MockInstance;

  beforeEach(() => {
    const ws = new Workspace(true, 'fs');
    exporter = new CustomExporter('', ws.location);
    addMediaSpy = vi
      .spyOn(exporter, 'addMedia')
      .mockImplementation(() => 'fake-abs-path');
  });

  test('default (embed-images on) returns an <img> tag and registers media', async () => {
    const settings = new CardOption({});
    const handler = new BlockHandler(exporter, fakeApi, settings);
    const block = makeImageBlock('https://example.com/diagram.png');

    const result = await handler.embedImage(block);

    expect(result).toMatch(/^<img src="[^"]+\.png" \/>$/);
    expect(addMediaSpy).toHaveBeenCalledTimes(1);
  });

  test('embed-images off returns empty string and registers no media', async () => {
    const settings = new CardOption({ 'embed-images': 'false' });
    const handler = new BlockHandler(exporter, fakeApi, settings);
    const block = makeImageBlock('https://example.com/diagram.png');

    const result = await handler.embedImage(block);

    expect(result).toBe('');
    expect(addMediaSpy).not.toHaveBeenCalled();
  });
});
