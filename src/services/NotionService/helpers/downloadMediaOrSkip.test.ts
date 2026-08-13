import axios, { AxiosError } from 'axios';
import dns from 'dns';

import { downloadMediaOrSkip } from './downloadMediaOrSkip';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      isAxiosError: actual.isAxiosError,
    },
  };
});

jest.mock('dns', () => ({
  __esModule: true,
  default: { promises: { lookup: jest.fn() } },
  promises: { lookup: jest.fn() },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedLookup = dns.promises.lookup as jest.Mock;

const makeAxiosError = (status: number): AxiosError => {
  const err = new Error(
    `Request failed with status code ${status}`
  ) as AxiosError;
  err.isAxiosError = true;
  err.response = {
    status,
    statusText: '',
    headers: {},
    config: {} as never,
    data: null,
  };
  return err;
};

describe('downloadMediaOrSkip', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockedLookup.mockImplementation(async () => [
      { address: '13.224.0.1', family: 4 },
    ]);
  });

  test('returns axios response data on success', async () => {
    const data = Buffer.from('fake bytes');
    mockedAxios.get.mockResolvedValueOnce({ data });

    const result = await downloadMediaOrSkip('https://example.test/asset.png');

    expect(result).toBe(data);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://example.test/asset.png',
      expect.objectContaining({
        responseType: 'arraybuffer',
        lookup: expect.any(Function),
      })
    );
  });

  test('returns null without warning on 403 so the caller owns the drop signal', async () => {
    mockedAxios.get.mockRejectedValueOnce(makeAxiosError(403));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await downloadMediaOrSkip(
      'https://example.test/expired.png'
    );

    expect(result).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('returns null without warning on 404 so the caller owns the drop signal', async () => {
    mockedAxios.get.mockRejectedValueOnce(makeAxiosError(404));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await downloadMediaOrSkip(
      'https://example.test/missing.png'
    );

    expect(result).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('rethrows non-4xx axios errors', async () => {
    mockedAxios.get.mockRejectedValueOnce(makeAxiosError(500));

    await expect(
      downloadMediaOrSkip('https://example.test/broken.png')
    ).rejects.toThrow('Request failed with status code 500');
  });

  test('rethrows non-axios errors', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(
      downloadMediaOrSkip('https://example.test/broken.png')
    ).rejects.toThrow('socket hang up');
  });

  test('decodes a base64 data URI without fetching', async () => {
    const payload = Buffer.from('hello').toString('base64');
    const result = await downloadMediaOrSkip(
      `data:image/png;base64,${payload}`
    );
    expect(result).toEqual(Buffer.from('hello'));
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  test('returns null for a data URI with no comma', async () => {
    const result = await downloadMediaOrSkip('data:image/png;base64');
    expect(result).toBeNull();
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });
});
