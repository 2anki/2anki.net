import { GetBlockResponse } from '@notionhq/client/build/src/api-endpoints';

import { downloadWithFreshUrlRetry } from './downloadWithFreshUrlRetry';
import { downloadMediaOrSkip } from './downloadMediaOrSkip';
import NotionAPIWrapper from '../NotionAPIWrapper';

jest.mock('./downloadMediaOrSkip', () => ({
  __esModule: true,
  downloadMediaOrSkip: jest.fn(),
}));

const mockedDownload = downloadMediaOrSkip as jest.MockedFunction<
  typeof downloadMediaOrSkip
>;

const makeApi = (freshBlock: GetBlockResponse): NotionAPIWrapper =>
  ({
    getBlock: jest.fn(async () => freshBlock),
  }) as unknown as NotionAPIWrapper;

describe('downloadWithFreshUrlRetry', () => {
  let warn: jest.SpyInstance;
  let info: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    info = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
    info.mockRestore();
  });

  test('returns bytes on the first download without re-fetching the block', async () => {
    const bytes = Buffer.from('first-try');
    mockedDownload.mockResolvedValueOnce(bytes);
    const api = makeApi({} as GetBlockResponse);

    const result = await downloadWithFreshUrlRetry({
      api,
      blockId: 'block-1',
      url: 'https://notion.s3/expiring.png',
      sourceType: 'file',
      extractFreshUrl: () => 'https://notion.s3/fresh.png',
    });

    expect(result).toBe(bytes);
    expect(mockedDownload).toHaveBeenCalledTimes(1);
    expect(api.getBlock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  test('re-resolves a fresh signed URL and retries once when the first download fails', async () => {
    const recovered = Buffer.from('recovered-bytes');
    mockedDownload.mockResolvedValueOnce(null).mockResolvedValueOnce(recovered);
    const freshBlock = { id: 'block-1' } as GetBlockResponse;
    const api = makeApi(freshBlock);
    const extractFreshUrl = jest.fn(() => 'https://notion.s3/fresh.png');

    const result = await downloadWithFreshUrlRetry({
      api,
      blockId: 'block-1',
      url: 'https://notion.s3/expired.png',
      sourceType: 'file',
      extractFreshUrl,
    });

    expect(result).toBe(recovered);
    expect(api.getBlock).toHaveBeenCalledWith('block-1');
    expect(extractFreshUrl).toHaveBeenCalledWith(freshBlock);
    expect(mockedDownload).toHaveBeenNthCalledWith(
      1,
      'https://notion.s3/expired.png'
    );
    expect(mockedDownload).toHaveBeenNthCalledWith(
      2,
      'https://notion.s3/fresh.png'
    );
    expect(info).toHaveBeenCalledWith(expect.stringContaining('Recovered'));
    expect(warn).not.toHaveBeenCalled();
  });

  test('does not retry external assets — their URLs do not expire', async () => {
    mockedDownload.mockResolvedValueOnce(null);
    const api = makeApi({} as GetBlockResponse);

    const result = await downloadWithFreshUrlRetry({
      api,
      blockId: 'block-1',
      url: 'https://third-party.example/asset.png',
      sourceType: 'external',
      extractFreshUrl: () => 'https://third-party.example/asset.png',
    });

    expect(result).toBeNull();
    expect(api.getBlock).not.toHaveBeenCalled();
    expect(mockedDownload).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping media fetch')
    );
    expect(info).not.toHaveBeenCalled();
  });

  test('retries at most once — a second expiry yields null, not a third fetch', async () => {
    mockedDownload.mockResolvedValue(null);
    const api = makeApi({ id: 'block-1' } as GetBlockResponse);

    const result = await downloadWithFreshUrlRetry({
      api,
      blockId: 'block-1',
      url: 'https://notion.s3/expired.png',
      sourceType: 'file',
      extractFreshUrl: () => 'https://notion.s3/still-expired.png',
    });

    expect(result).toBeNull();
    expect(api.getBlock).toHaveBeenCalledTimes(1);
    expect(mockedDownload).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping media fetch')
    );
    expect(info).not.toHaveBeenCalled();
  });

  test('gives up gracefully when the fresh block yields no URL', async () => {
    mockedDownload.mockResolvedValueOnce(null);
    const api = makeApi({ id: 'block-1' } as GetBlockResponse);

    const result = await downloadWithFreshUrlRetry({
      api,
      blockId: 'block-1',
      url: 'https://notion.s3/expired.png',
      sourceType: 'file',
      extractFreshUrl: () => null,
    });

    expect(result).toBeNull();
    expect(api.getBlock).toHaveBeenCalledTimes(1);
    expect(mockedDownload).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping media fetch')
    );
    expect(info).not.toHaveBeenCalled();
  });

  test('gives up gracefully when re-fetching the block throws', async () => {
    mockedDownload.mockResolvedValueOnce(null);
    const api = {
      getBlock: jest.fn(async () => {
        throw new Error('notion unreachable');
      }),
    } as unknown as NotionAPIWrapper;

    const result = await downloadWithFreshUrlRetry({
      api,
      blockId: 'block-1',
      url: 'https://notion.s3/expired.png',
      sourceType: 'file',
      extractFreshUrl: () => 'https://notion.s3/fresh.png',
    });

    expect(result).toBeNull();
    expect(mockedDownload).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Skipping media fetch')
    );
    expect(info).not.toHaveBeenCalled();
  });
});
