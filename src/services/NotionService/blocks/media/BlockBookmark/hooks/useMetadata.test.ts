import { vi, type Mock, type Mocked } from 'vitest';
import axios from 'axios';
import dns from 'dns';

import useMetadata from './useMetadata';

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

const scrape = vi.fn();
vi.mock(
  'metascraper',
  () =>
    () =>
    (...args: unknown[]) =>
      scrape(...args)
);
vi.mock('metascraper-description', () => () => ({}));
vi.mock('metascraper-image', () => () => ({}));
vi.mock('metascraper-logo-favicon', () => () => ({}));
vi.mock('metascraper-title', () => () => ({}));
vi.mock('metascraper-url', () => () => ({}));

const mockedAxios = axios as Mocked<typeof axios>;
const mockedLookup = dns.promises.lookup as Mock;

describe('useMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLookup.mockResolvedValue([{ address: '13.224.0.1', family: 4 }]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('scrapes metadata for a normal public bookmark URL', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: '<html><head><title>Spaced repetition</title></head><body></body></html>',
    });
    scrape.mockResolvedValueOnce({
      title: 'Spaced repetition',
      description: 'A learning technique',
      logo: 'https://example.com/logo.png',
      image: 'https://example.com/og.png',
    });

    const result = await useMetadata('https://example.com/article');

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://example.com/article',
      expect.objectContaining({ lookup: expect.any(Function) })
    );
    expect(result.title).toBe('Spaced repetition');
  });

  it('refuses a loopback bookmark URL without making an outbound request', async () => {
    const result = await useMetadata('https://127.0.0.1/admin');

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(scrape).not.toHaveBeenCalled();
    expect(result).toEqual({
      description: '',
      title: '127.0.0.1',
      logo: '',
      image: '',
    });
  });

  it('refuses a cloud-metadata bookmark URL without making an outbound request', async () => {
    const result = await useMetadata(
      'https://169.254.169.254/latest/meta-data'
    );

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(scrape).not.toHaveBeenCalled();
    expect(result.title).toBe('169.254.169.254');
  });

  it('refuses a DNS-rebinding host that resolves to a private IP', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '169.254.169.254', family: 4 },
    ]);

    const result = await useMetadata('https://imds.attacker.example/meta');

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(scrape).not.toHaveBeenCalled();
    expect(result.title).toBe('imds.attacker.example');
  });
});
