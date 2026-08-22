import axios from 'axios';
import dns from 'dns';

import useMetadata from './useMetadata';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      isAxiosError: actual.isAxiosError,
    },
  };
});

jest.mock('dns', () => ({
  __esModule: true,
  default: { promises: { lookup: jest.fn() } },
  promises: { lookup: jest.fn() },
}));

const scrape = jest.fn();
jest.mock(
  'metascraper',
  () =>
    () =>
    (...args: unknown[]) =>
      scrape(...args)
);
jest.mock('metascraper-description', () => () => ({}), { virtual: true });
jest.mock('metascraper-image', () => () => ({}), { virtual: true });
jest.mock('metascraper-logo-favicon', () => () => ({}), { virtual: true });
jest.mock('metascraper-title', () => () => ({}), { virtual: true });
jest.mock('metascraper-url', () => () => ({}), { virtual: true });

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedLookup = dns.promises.lookup as jest.Mock;

describe('useMetadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedLookup.mockResolvedValue([{ address: '13.224.0.1', family: 4 }]);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('scrapes metadata for a normal public bookmark URL', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      status: 200,
      data: '<html></html>',
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
