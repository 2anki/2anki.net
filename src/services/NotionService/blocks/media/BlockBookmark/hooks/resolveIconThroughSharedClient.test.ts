import { vi, type Mock, type Mocked } from 'vitest';
import axios from 'axios';
import dns from 'dns';

import { resolveIconThroughSharedClient } from './resolveIconThroughSharedClient';

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

const mockedAxios = axios as Mocked<typeof axios>;
const mockedLookup = dns.promises.lookup as Mock;

const ICON_URL = 'https://icons.example.com/icon.png';
const PNG_TYPES = ['png', ['image/png']];

const respondWith = (headers: Record<string, string>, data: unknown) => {
  mockedAxios.get.mockResolvedValueOnce({ status: 200, headers, data });
};

describe('resolveIconThroughSharedClient', () => {
  let warn: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedLookup.mockResolvedValue([{ address: '13.224.0.1', family: 4 }]);
    warn = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined) as unknown as Mock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks the shared client for the first byte only, with a timeout and a size cap', async () => {
    respondWith({ 'content-type': 'image/png' }, Buffer.from([0x89]));

    await resolveIconThroughSharedClient(ICON_URL, PNG_TYPES);

    expect(mockedAxios.get).toHaveBeenCalledWith(
      ICON_URL,
      expect.objectContaining({
        headers: { Range: 'bytes=0-0' },
        timeout: 5000,
        maxContentLength: 1024 * 1024,
        lookup: expect.any(Function),
      })
    );
  });

  it.each([
    ['an image of the expected type', 'image/png', [0x89], ICON_URL],
    ['a type with parameters', 'image/png; charset=binary', [0x89], ICON_URL],
    ['an unexpected type', 'text/html', [0x89], undefined],
    ['markup served as an image', 'image/png', [0x3c], undefined],
    ['an empty body', 'image/png', [], undefined],
  ])('judges %s', async (_label, type, bytes, expected) => {
    respondWith({ 'content-type': type }, Buffer.from(bytes));

    const result = await resolveIconThroughSharedClient(ICON_URL, PNG_TYPES);

    expect(result?.url).toBe(expected);
  });

  it('accepts any reachable response when no content type is expected', async () => {
    respondWith({ 'content-type': 'image/svg+xml' }, Buffer.from('<svg/>'));

    const result = await resolveIconThroughSharedClient(
      'https://icons.example.com/icon.svg'
    );

    expect(result).toEqual({ url: 'https://icons.example.com/icon.svg' });
  });

  it('leaves the icon out when the shared client refuses the address, and logs without the URL', async () => {
    const result = await resolveIconThroughSharedClient(
      'https://10.0.0.5/icon.png',
      PNG_TYPES
    );

    expect(result).toBeUndefined();
    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      '[bookmark-icon] shared client refused an icon URL'
    );
  });

  it('leaves the icon out quietly when the icon is not found', async () => {
    mockedAxios.get.mockRejectedValueOnce(
      Object.assign(new Error('status 404'), {
        isAxiosError: true,
        response: { status: 404, headers: {}, data: null },
      })
    );

    const result = await resolveIconThroughSharedClient(ICON_URL, PNG_TYPES);

    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});
