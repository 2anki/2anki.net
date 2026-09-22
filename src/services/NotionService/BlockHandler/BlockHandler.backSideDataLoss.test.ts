import {
  BlockObjectResponse,
  GetBlockResponse,
  ImageBlockObjectResponse,
  ListBlockChildrenResponse,
  ParagraphBlockObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';

import { setupTests } from '../../../test/configure-jest';
import CustomExporter from '../../../lib/parser/exporters/CustomExporter';
import Workspace from '../../../lib/parser/WorkSpace';
import CardOption from '../../../lib/parser/Settings/CardOption';
import BlockHandler from './BlockHandler';
import NotionAPIWrapper from '../NotionAPIWrapper';
import { downloadMediaOrSkip } from '../helpers/downloadMediaOrSkip';

beforeEach(() => setupTests());

jest.mock('../helpers/isTesting', () => ({
  __esModule: true,
  default: jest.fn(() => false),
}));

jest.mock('../helpers/downloadMediaOrSkip', () => ({
  __esModule: true,
  downloadMediaOrSkip: jest.fn(),
}));

const mockedDownload = downloadMediaOrSkip as jest.MockedFunction<
  typeof downloadMediaOrSkip
>;

function makeToggleBlock(): BlockObjectResponse {
  return {
    object: 'block',
    id: 'toggle-1',
    parent: { type: 'page_id', page_id: 'page-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: true,
    archived: false,
    in_trash: false,
    type: 'toggle',
    toggle: { rich_text: [], color: 'default' },
  } as unknown as BlockObjectResponse;
}

function makeParagraphBlock(text: string): ParagraphBlockObjectResponse {
  return {
    object: 'block',
    id: 'paragraph-1',
    parent: { type: 'block_id', block_id: 'toggle-1' },
    created_time: '',
    last_edited_time: '',
    created_by: { object: 'user', id: 'u' },
    last_edited_by: { object: 'user', id: 'u' },
    has_children: false,
    archived: false,
    in_trash: false,
    type: 'paragraph',
    paragraph: {
      color: 'default',
      rich_text: [
        {
          type: 'text',
          text: { content: text, link: null },
          annotations: {
            bold: false,
            italic: false,
            strikethrough: false,
            underline: false,
            code: false,
            color: 'default',
          },
          plain_text: text,
          href: null,
        },
      ],
    },
  } as unknown as ParagraphBlockObjectResponse;
}

function makeFileImageBlock(url: string): ImageBlockObjectResponse {
  return {
    object: 'block',
    id: 'img-file-1',
    parent: { type: 'block_id', block_id: 'toggle-1' },
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

function makeChildrenResponse(
  children: BlockObjectResponse[]
): ListBlockChildrenResponse {
  return {
    object: 'list',
    results: children,
    next_cursor: null,
    has_more: false,
    type: 'block',
    block: {},
  } as unknown as ListBlockChildrenResponse;
}

describe('BlockHandler back-side data loss on media failure', () => {
  let exporter: CustomExporter;

  beforeEach(() => {
    jest.clearAllMocks();
    const ws = new Workspace(true, 'fs');
    exporter = new CustomExporter('', ws.location);
    jest.spyOn(exporter, 'addMedia').mockImplementation(() => 'fake-abs-path');
  });

  function buildHandler(): BlockHandler {
    const children = makeChildrenResponse([
      makeParagraphBlock('Answer text'),
      makeFileImageBlock('https://notion.s3/img-expired.png'),
    ]);
    const freshImage = makeFileImageBlock(
      'https://notion.s3/img-fresh.png'
    ) as unknown as GetBlockResponse;
    const api = {
      getBlocks: jest.fn(async () => children),
      getBlock: jest.fn(async () => freshImage),
    } as unknown as NotionAPIWrapper;
    return new BlockHandler(exporter, api, new CardOption({}));
  }

  test('keeps the recoverable text and shows a placeholder when media keeps failing', async () => {
    mockedDownload.mockRejectedValue(new Error('socket hang up'));
    const handler = buildHandler();

    const back = await handler.getBackSide(makeToggleBlock());

    expect(back).not.toBeNull();
    expect(back).toContain('Answer text');
    expect(back).toContain("couldn't be loaded");
    expect(back).not.toContain('<img');
  });

  test('recovers the media when a fresh fetch succeeds on retry', async () => {
    mockedDownload
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValue(Buffer.from('recovered-image-bytes'));
    const handler = buildHandler();

    const back = await handler.getBackSide(makeToggleBlock());

    expect(back).not.toBeNull();
    expect(back).toContain('Answer text');
    expect(back).toMatch(/<img src="[^"]+" \/>/);
    expect(back).not.toContain("couldn't be loaded");
  });
});
