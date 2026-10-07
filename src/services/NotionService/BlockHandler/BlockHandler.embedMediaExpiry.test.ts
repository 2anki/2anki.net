import { vi, type MockedFunction, type MockInstance } from 'vitest';
import {
  AudioBlockObjectResponse,
  FileBlockObjectResponse,
  GetBlockResponse,
  ImageBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

import { setupTests } from '../../../test/configure-jest';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import Workspace from '../../../lib/parser/WorkSpace';
import CardOption from '../../../lib/parser/Settings/CardOption';
import BlockHandler from './BlockHandler';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { downloadMediaOrSkip } from '../helpers/downloadMediaOrSkip';

beforeEach(() => setupTests());

vi.mock('../helpers/isTesting', () => ({
  __esModule: true,
  default: vi.fn(() => false),
}));

vi.mock('../helpers/downloadMediaOrSkip', () => ({
  __esModule: true,
  downloadMediaOrSkip: vi.fn(),
}));

const mockedDownload = downloadMediaOrSkip as MockedFunction<
  typeof downloadMediaOrSkip
>;

function makeFileImageBlock(url: string): ImageBlockObjectResponse {
  return {
    object: 'block',
    id: 'img-file-1',
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
      type: 'file',
      file: { url, expiry_time: '' },
      caption: [],
    },
  } as unknown as ImageBlockObjectResponse;
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

function makeFileBlock(url: string): FileBlockObjectResponse {
  return {
    object: 'block',
    id: 'file-1',
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'file',
    file: {
      type: 'file',
      file: { url, expiry_time: '' },
      caption: [],
      name: 'notes.pdf',
    },
  } as unknown as FileBlockObjectResponse;
}

describe('BlockHandler media expiry recovery', () => {
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

  test('embedImage recovers a file-type image after the first signed URL expires', async () => {
    const recovered = Buffer.from('recovered-image-bytes');
    mockedDownload.mockResolvedValueOnce(null).mockResolvedValueOnce(recovered);
    const freshBlock = makeFileImageBlock(
      'https://notion.s3/img-fresh.png'
    ) as unknown as GetBlockResponse;
    const api = {
      getBlock: vi.fn(async () => freshBlock),
    } as unknown as NotionAPIWrapper;
    const handler = new BlockHandler(exporter, api, new CardOption({}));

    const result = await handler.embedImage(
      makeFileImageBlock('https://notion.s3/img-expired.png')
    );

    expect(result).toMatch(/^<img src="[^"]+\.png" \/>$/);
    expect(api.getBlock).toHaveBeenCalledWith('img-file-1');
    expect(addMediaSpy).toHaveBeenCalledTimes(1);
    expect(addMediaSpy.mock.calls[0][1]).toBe(recovered);
  });

  test('embedAudioFile recovers a file-type audio asset after expiry', async () => {
    const recovered = Buffer.from('recovered-audio-bytes');
    mockedDownload.mockResolvedValueOnce(null).mockResolvedValueOnce(recovered);
    const freshBlock = makeFileAudioBlock(
      'https://notion.s3/audio-fresh.mp3'
    ) as unknown as GetBlockResponse;
    const api = {
      getBlock: vi.fn(async () => freshBlock),
    } as unknown as NotionAPIWrapper;
    const handler = new BlockHandler(exporter, api, new CardOption({}));

    const result = await handler.embedAudioFile(
      makeFileAudioBlock('https://notion.s3/audio-expired.mp3')
    );

    expect(result).toMatch(/^\[sound:.+\]$/);
    expect(api.getBlock).toHaveBeenCalledWith('audio-file-1');
    expect(addMediaSpy).toHaveBeenCalledTimes(1);
    expect(addMediaSpy.mock.calls[0][1]).toBe(recovered);
  });

  test('embedFile recovers a file-type attachment after expiry', async () => {
    const recovered = Buffer.from('recovered-file-bytes');
    mockedDownload.mockResolvedValueOnce(null).mockResolvedValueOnce(recovered);
    const freshBlock = makeFileBlock(
      'https://notion.s3/file-fresh.pdf'
    ) as unknown as GetBlockResponse;
    const api = {
      getBlock: vi.fn(async () => freshBlock),
    } as unknown as NotionAPIWrapper;
    const handler = new BlockHandler(exporter, api, new CardOption({}));

    const result = await handler.embedFile(
      makeFileBlock('https://notion.s3/file-expired.pdf')
    );

    expect(result).toMatch(/^<embed src=".+" \/>$/);
    expect(api.getBlock).toHaveBeenCalledWith('file-1');
    expect(addMediaSpy).toHaveBeenCalledTimes(1);
    expect(addMediaSpy.mock.calls[0][1]).toBe(recovered);
  });

  test('embedImage drops the asset only after the retry also fails', async () => {
    mockedDownload.mockResolvedValue(null);
    const freshBlock = makeFileImageBlock(
      'https://notion.s3/img-still-expired.png'
    ) as unknown as GetBlockResponse;
    const api = {
      getBlock: vi.fn(async () => freshBlock),
    } as unknown as NotionAPIWrapper;
    const handler = new BlockHandler(exporter, api, new CardOption({}));

    const result = await handler.embedImage(
      makeFileImageBlock('https://notion.s3/img-expired.png')
    );

    expect(result).toBe('');
    expect(api.getBlock).toHaveBeenCalledTimes(1);
    expect(mockedDownload).toHaveBeenCalledTimes(2);
    expect(addMediaSpy).not.toHaveBeenCalled();
    expect(handler.droppedAssetCount).toBe(1);
  });

  test('does not count a dropped asset when the download recovers', async () => {
    const recovered = Buffer.from('recovered-image-bytes');
    mockedDownload.mockResolvedValueOnce(null).mockResolvedValueOnce(recovered);
    const freshBlock = makeFileImageBlock(
      'https://notion.s3/img-fresh.png'
    ) as unknown as GetBlockResponse;
    const api = {
      getBlock: vi.fn(async () => freshBlock),
    } as unknown as NotionAPIWrapper;
    const handler = new BlockHandler(exporter, api, new CardOption({}));

    await handler.embedImage(
      makeFileImageBlock('https://notion.s3/img-expired.png')
    );

    expect(handler.droppedAssetCount).toBe(0);
  });
});
