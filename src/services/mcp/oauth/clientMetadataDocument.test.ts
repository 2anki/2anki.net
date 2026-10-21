import { vi, type Mock, type Mocked } from 'vitest';
import axios, { AxiosError } from 'axios';
import dns from 'dns';

import { makeInstrumentedAxios } from '../../observability/instrumentedAxios';
import { ObservabilitySink } from '../../observability/ObservabilitySink';
import type { IObservabilityRepository } from '../../../data_layer/ObservabilityRepository';
import {
  CIMD_DEFAULT_TTL_MS,
  CIMD_MAX_DOCUMENT_BYTES,
  CIMD_MAX_TTL_MS,
  ClientMetadataDocumentResolver,
  cacheTtlFromHeader,
  storageClientIdFor,
} from './clientMetadataDocument';

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

const CLIENT_ID = 'https://claude.ai/oauth/claude-code-client-metadata';

const fakeObservabilityRepo = {
  insertRequestLogs: async () => {},
  insertOutboundCallLogs: async () => {},
} as unknown as IObservabilityRepository;

function documentFor(overrides: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT_ID,
    client_name: 'Claude Code',
    redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    ...overrides,
  };
}

function okResponse(
  body: string,
  headers: Record<string, string> = { 'content-type': 'application/json' }
) {
  return {
    status: 200,
    statusText: 'OK',
    headers,
    config: {} as never,
    data: body,
  };
}

function makeResolver(now: { value: number } = { value: 1_000_000 }) {
  return new ClientMetadataDocumentResolver({
    http: makeInstrumentedAxios(new ObservabilitySink(fakeObservabilityRepo)),
    now: () => now.value,
  });
}

describe('ClientMetadataDocumentResolver', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedLookup.mockResolvedValue([{ address: '160.79.104.10', family: 4 }]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves a valid document into a public client', async () => {
    mockedAxios.get.mockResolvedValue(
      okResponse(JSON.stringify(documentFor()))
    );

    const client = await makeResolver().resolve(CLIENT_ID);

    expect(client).toEqual({
      client_id: CLIENT_ID,
      client_name: 'Claude Code',
      redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: undefined,
      token_endpoint_auth_method: 'none',
    });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      CLIENT_ID,
      expect.objectContaining({
        maxRedirects: 0,
        maxContentLength: CIMD_MAX_DOCUMENT_BYTES,
        timeout: 5000,
      })
    );
  });

  it('serves a cached document until its max-age runs out', async () => {
    mockedAxios.get.mockResolvedValue(
      okResponse(JSON.stringify(documentFor()), {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=60',
      })
    );
    const now = { value: 1_000_000 };
    const resolver = makeResolver(now);

    await resolver.resolve(CLIENT_ID);
    now.value += 59_000;
    await resolver.resolve(CLIENT_ID);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);

    now.value += 2_000;
    await resolver.resolve(CLIENT_ID);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('does not cache a no-store document', async () => {
    mockedAxios.get.mockResolvedValue(
      okResponse(JSON.stringify(documentFor()), {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      })
    );
    const resolver = makeResolver();

    await resolver.resolve(CLIENT_ID);
    await resolver.resolve(CLIENT_ID);

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry when the cache is full', async () => {
    const ids = ['a', 'b', 'c'].map((s) => `https://example.com/${s}.json`);
    mockedAxios.get.mockImplementation(async (url: string) =>
      okResponse(JSON.stringify(documentFor({ client_id: url })))
    );
    const resolver = new ClientMetadataDocumentResolver({
      http: makeInstrumentedAxios(new ObservabilitySink(fakeObservabilityRepo)),
      now: () => 0,
      maxEntries: 2,
    });

    for (const id of ids) {
      await resolver.resolve(id);
    }
    await resolver.resolve(ids[2]);
    await resolver.resolve(ids[0]);

    expect(mockedAxios.get).toHaveBeenCalledTimes(4);
  });

  it('rejects a document whose client_id differs from the URL', async () => {
    mockedAxios.get.mockResolvedValue(
      okResponse(
        JSON.stringify(documentFor({ client_id: 'https://evil.example/doc' }))
      )
    );

    await expect(makeResolver().resolve(CLIENT_ID)).rejects.toMatchObject({
      reason: 'client_id_mismatch',
    });
  });

  it.each([
    ['http scheme', 'http://claude.ai/oauth/metadata'],
    ['no path', 'https://claude.ai/'],
    ['fragment', 'https://claude.ai/oauth/metadata#x'],
    ['dot segments', 'https://claude.ai/a/../metadata'],
    ['credentials', 'https://user:pass@claude.ai/metadata'],
  ])('rejects a client_id URL with %s without fetching', async (_, url) => {
    await expect(makeResolver().resolve(url)).rejects.toMatchObject({
      reason: 'invalid_url',
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('refuses a host that resolves to a private address', async () => {
    mockedLookup.mockResolvedValue([
      { address: '160.79.104.10', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);

    await expect(makeResolver().resolve(CLIENT_ID)).rejects.toMatchObject({
      reason: 'fetch_failed',
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it.each([
    'https://127.0.0.1/metadata',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/metadata',
    'https://localhost/metadata',
  ])('refuses the loopback or link-local host %s', async (url) => {
    await expect(makeResolver().resolve(url)).rejects.toMatchObject({
      reason: 'fetch_failed',
    });
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('rejects a document larger than the size cap', async () => {
    const padding = 'x'.repeat(CIMD_MAX_DOCUMENT_BYTES);
    mockedAxios.get.mockResolvedValue(
      okResponse(JSON.stringify(documentFor({ padding })))
    );

    await expect(makeResolver().resolve(CLIENT_ID)).rejects.toMatchObject({
      reason: 'too_large',
    });
  });

  it('maps an axios maxContentLength abort to too_large', async () => {
    mockedAxios.get.mockRejectedValue(
      new Error('maxContentLength size of 65536 exceeded')
    );

    await expect(makeResolver().resolve(CLIENT_ID)).rejects.toMatchObject({
      reason: 'too_large',
    });
  });

  it('gives up after the fetch timeout', async () => {
    vi.useFakeTimers();
    mockedAxios.get.mockImplementation(() => new Promise(() => {}));

    const pending = makeResolver().resolve(CLIENT_ID);
    const assertion = expect(pending).rejects.toMatchObject({
      reason: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(5000);

    await assertion;
  });

  it('rejects a response that is not JSON', async () => {
    mockedAxios.get.mockResolvedValue(
      okResponse('<html></html>', { 'content-type': 'text/html' })
    );

    await expect(makeResolver().resolve(CLIENT_ID)).rejects.toMatchObject({
      reason: 'not_json',
    });
  });

  it.each([301, 302, 307, 308])(
    'refuses to follow a %d redirect to another host',
    async (status) => {
      const error = new Error(`status ${status}`) as AxiosError;
      error.isAxiosError = true;
      error.response = {
        status,
        statusText: '',
        headers: { location: 'https://attacker.example/doc.json' },
        config: {} as never,
        data: null,
      };
      mockedAxios.get.mockRejectedValueOnce(error);
      mockedAxios.get.mockResolvedValue(
        okResponse(JSON.stringify(documentFor()))
      );

      await expect(makeResolver().resolve(CLIENT_ID)).rejects.toMatchObject({
        reason: 'bad_status',
      });
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects a non-200 response', async () => {
    const error = new Error('Request failed') as AxiosError;
    error.isAxiosError = true;
    error.response = {
      status: 404,
      statusText: '',
      headers: {},
      config: {} as never,
      data: null,
    };
    mockedAxios.get.mockRejectedValue(error);

    await expect(makeResolver().resolve(CLIENT_ID)).rejects.toMatchObject({
      reason: 'bad_status',
    });
  });

  it.each([
    ['missing', { redirect_uris: undefined }],
    ['empty', { redirect_uris: [] }],
    ['not strings', { redirect_uris: [42] }],
    ['plain http', { redirect_uris: ['http://evil.example/cb'] }],
  ])('rejects redirect_uris that are %s', async (_, overrides) => {
    mockedAxios.get.mockResolvedValue(
      okResponse(JSON.stringify(documentFor(overrides)))
    );

    await expect(makeResolver().resolve(CLIENT_ID)).rejects.toMatchObject({
      reason: 'invalid_redirect_uris',
    });
  });

  it.each([
    ['a client secret', { client_secret: 's3cret' }],
    [
      'a confidential auth method',
      { token_endpoint_auth_method: 'private_key_jwt' },
    ],
  ])('rejects a document with %s', async (_, overrides) => {
    mockedAxios.get.mockResolvedValue(
      okResponse(JSON.stringify(documentFor(overrides)))
    );

    await expect(makeResolver().resolve(CLIENT_ID)).rejects.toMatchObject({
      reason: 'unsupported_auth_method',
    });
  });
});

describe('cacheTtlFromHeader', () => {
  it.each([
    [undefined, CIMD_DEFAULT_TTL_MS],
    ['', CIMD_DEFAULT_TTL_MS],
    ['public', CIMD_DEFAULT_TTL_MS],
    ['max-age=120', 120_000],
    ['public, max-age=0', 0],
    ['no-store', 0],
    ['no-cache, max-age=60', 0],
    ['max-age=99999999', CIMD_MAX_TTL_MS],
  ])('maps %s to %d ms', (header, expected) => {
    expect(cacheTtlFromHeader(header)).toBe(expected);
  });
});

describe('storageClientIdFor', () => {
  it('passes a DCR client id through unchanged', () => {
    const id = '6f1c1c9e-6d0c-4a43-9c55-0e5bb1d7a0a1';
    expect(storageClientIdFor(id)).toBe(id);
  });

  it('maps a CIMD URL to a stable id that fits the 64-char column', () => {
    const id = storageClientIdFor(`${CLIENT_ID}?${'q'.repeat(500)}`);
    expect(id).toMatch(/^cimd_[0-9a-f]{56}$/);
    expect(storageClientIdFor(CLIENT_ID)).toBe(storageClientIdFor(CLIENT_ID));
    expect(storageClientIdFor(CLIENT_ID)).not.toBe(id);
  });
});
