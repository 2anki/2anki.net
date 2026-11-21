import { vi, type Mock, type Mocked } from 'vitest';
import axios, { AxiosError } from 'axios';
import dns from 'dns';
import http from 'node:http';
import https from 'node:https';

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

const mockedAxios = axios as Mocked<typeof axios>;
const mockedLookup = dns.promises.lookup as Mock;

interface FakeResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

const PUBLIC_ADDRESS = [{ address: '13.224.0.1', family: 4 }];

const notFound = (url: string): AxiosError => {
  const error = new Error(`status 404 for ${url}`) as AxiosError;
  error.isAxiosError = true;
  error.response = {
    status: 404,
    statusText: 'Not Found',
    headers: {},
    config: {} as never,
    data: null,
  };
  return error;
};

const htmlPage = (head: string): FakeResponse => ({
  status: 200,
  headers: { 'content-type': 'text/html' },
  data: `<html><head><title>Spaced repetition</title><meta name="description" content="A learning technique">${head}</head><body></body></html>`,
});

const pngIcon = (): FakeResponse => ({
  status: 206,
  headers: { 'content-type': 'image/png' },
  data: Buffer.from([0x89]),
});

const serve = (routes: Record<string, FakeResponse>) => {
  mockedAxios.get.mockImplementation(async (url: string) => {
    const route = routes[url];
    if (route == null) throw notFound(url);
    return route;
  });
};

const requestedUrls = (): string[] =>
  mockedAxios.get.mock.calls.map(([url]) => String(url));

let httpRequest: Mock;
let httpsRequest: Mock;
let httpGet: Mock;
let httpsGet: Mock;

const refuseRawRequest = () => {
  throw new Error('raw request outside the shared client');
};

describe('useMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLookup.mockResolvedValue(PUBLIC_ADDRESS);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    httpRequest = vi
      .spyOn(http, 'request')
      .mockImplementation(refuseRawRequest) as unknown as Mock;
    httpsRequest = vi
      .spyOn(https, 'request')
      .mockImplementation(refuseRawRequest) as unknown as Mock;
    httpGet = vi
      .spyOn(http, 'get')
      .mockImplementation(refuseRawRequest) as unknown as Mock;
    httpsGet = vi
      .spyOn(https, 'get')
      .mockImplementation(refuseRawRequest) as unknown as Mock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scrapes metadata for a normal public bookmark URL', async () => {
    serve({ 'https://example.com/article': htmlPage('') });

    const result = await useMetadata('https://example.com/article');

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://example.com/article',
      expect.objectContaining({ lookup: expect.any(Function) })
    );
    expect(result.title).toBe('Spaced repetition');
    expect(result.description).toBe('A learning technique');
  });

  it('refuses a loopback bookmark URL without making an outbound request', async () => {
    const result = await useMetadata('https://127.0.0.1/admin');

    expect(mockedAxios.get).not.toHaveBeenCalled();
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
    expect(result.title).toBe('169.254.169.254');
  });

  it('refuses a bookmark host that resolves to a private IP', async () => {
    mockedLookup.mockResolvedValueOnce([
      { address: '169.254.169.254', family: 4 },
    ]);

    const result = await useMetadata('https://imds.rebinding.example/meta');

    expect(mockedAxios.get).not.toHaveBeenCalled();
    expect(result.title).toBe('imds.rebinding.example');
  });

  describe('site icon', () => {
    it('resolves the icon through the shared client', async () => {
      serve({
        'https://icon-public.com/article': htmlPage(
          '<link rel="apple-touch-icon" href="https://cdn.icon-public.com/touch.png">'
        ),
        'https://cdn.icon-public.com/touch.png': pngIcon(),
      });

      const result = await useMetadata('https://icon-public.com/article');

      expect(result.logo).toBe('https://cdn.icon-public.com/touch.png');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://cdn.icon-public.com/touch.png',
        expect.objectContaining({ lookup: expect.any(Function) })
      );
    });

    it.each([
      ['a relative href', '/static/icon.png', 'https://icon-relative.com'],
      [
        'a protocol-relative href',
        '//static.icon-protocol.com/icon.png',
        'https://icon-protocol.com',
      ],
    ])('resolves %s against the page URL', async (_label, href, origin) => {
      const expected = new URL(href, `${origin}/`).toString();
      serve({
        [`${origin}/article`]: htmlPage(`<link rel="icon" href="${href}">`),
        [expected]: pngIcon(),
      });

      const result = await useMetadata(`${origin}/article`);

      expect(result.logo).toBe(expected);
    });

    it('falls back to the favicon at the page origin when the declared icon is missing', async () => {
      serve({
        'https://icon-fallback.com/article': htmlPage(
          '<link rel="icon" href="/missing.png">'
        ),
        'https://icon-fallback.com/favicon.ico': {
          status: 200,
          headers: { 'content-type': 'image/x-icon' },
          data: Buffer.from([0x00]),
        },
      });

      const result = await useMetadata('https://icon-fallback.com/article');

      expect(result.logo).toBe('https://icon-fallback.com/favicon.ico');
    });

    it('leaves the icon out when the response is markup, not an image', async () => {
      serve({
        'https://icon-markup.com/article': htmlPage(''),
        'https://icon-markup.com/favicon.ico': {
          status: 200,
          headers: { 'content-type': 'image/x-icon' },
          data: Buffer.from('<html>'),
        },
      });

      const result = await useMetadata('https://icon-markup.com/article');

      expect(result.logo).toBeNull();
    });

    it.each([
      ['a private address', 'https://10.0.0.5/icon.png', '10.0.0.5'],
      ['a loopback address', 'https://127.0.0.1/icon.png', '127.0.0.1'],
      [
        'a link-local address',
        'https://169.254.169.254/latest/icon.png',
        '169.254.169.254',
      ],
      [
        'an IPv4-mapped IPv6 literal',
        'https://[::ffff:127.0.0.1]/icon.png',
        '::ffff:',
      ],
      [
        'a hostname that resolves to a private address',
        'https://intranet.icon-refused.com/icon.png',
        'intranet.icon-refused.com',
      ],
    ])(
      'leaves the icon out when the shared client refuses %s',
      async (_label, iconUrl, refusedHost) => {
        const pageUrl = `https://icon-refused-${refusedHost.replace(/[^a-z0-9]/g, '')}.com/article`;
        mockedLookup.mockImplementation(async (host: string) =>
          host === 'intranet.icon-refused.com'
            ? [{ address: '10.1.2.3', family: 4 }]
            : PUBLIC_ADDRESS
        );
        serve({
          [pageUrl]: htmlPage(`<link rel="icon" href="${iconUrl}">`),
        });

        const result = await useMetadata(pageUrl);

        expect(result).toMatchObject({
          title: 'Spaced repetition',
          description: 'A learning technique',
          logo: null,
        });
        expect(
          requestedUrls().filter((url) => url.includes(refusedHost))
        ).toEqual([]);
        expect(httpRequest).not.toHaveBeenCalled();
        expect(httpsRequest).not.toHaveBeenCalled();
      }
    );

    it('leaves the icon out when a public icon redirects to a private address', async () => {
      serve({
        'https://icon-redirect.com/article': htmlPage(
          '<link rel="icon" href="https://cdn.icon-redirect.com/icon.png">'
        ),
        'https://cdn.icon-redirect.com/icon.png': {
          status: 302,
          headers: { location: 'https://192.168.1.10/icon.png' },
          data: '',
        },
      });

      const result = await useMetadata('https://icon-redirect.com/article');

      expect(result).toMatchObject({
        title: 'Spaced repetition',
        logo: null,
      });
      expect(requestedUrls()).toContain(
        'https://cdn.icon-redirect.com/icon.png'
      );
      expect(
        requestedUrls().filter((url) => url.includes('192.168.1.10'))
      ).toEqual([]);
    });
  });

  it('makes no request outside the shared client while scraping a page', async () => {
    serve({
      'https://generic-site.com/article': htmlPage(
        [
          '<meta property="og:image" content="https://generic-site.com/og.png">',
          '<link rel="icon" href="/icon-32.png" sizes="32x32">',
          '<link rel="icon" href="/icon.svg">',
          '<meta name="msapplication-TileImage" content="/tile.png">',
          '<script type="application/ld+json">{"@type":"Article","image":"https://generic-site.com/ld.png"}</script>',
        ].join('')
      ),
    });

    const result = await useMetadata('https://generic-site.com/article');

    expect(result.title).toBe('Spaced repetition');
    expect(result.image).toBe('https://generic-site.com/og.png');
    expect(httpRequest).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(httpGet).not.toHaveBeenCalled();
    expect(httpsGet).not.toHaveBeenCalled();
  });
});
