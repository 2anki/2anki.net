import { vi, type Mock, type Mocked } from 'vitest';
import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import dns from 'dns';
import { inspect } from 'node:util';

import {
  makeInstrumentedAxios,
  OBSERVABILITY_SERVICES,
} from './instrumentedAxios';
import { ObservabilitySink } from './ObservabilitySink';
import {
  IObservabilityRepository,
  OutboundCallLogRow,
  RequestLogRow,
} from '../../data_layer/ObservabilityRepository';

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

const mockPublicLookup = () => {
  mockedLookup.mockImplementation(async () => [
    { address: '13.224.0.1', family: 4 },
  ]);
};

class FakeRepo implements IObservabilityRepository {
  inbound: RequestLogRow[] = [];
  outbound: OutboundCallLogRow[] = [];

  insertRequestLogs = async (rows: RequestLogRow[]) => {
    this.inbound.push(...rows);
  };
  insertOutboundCallLogs = async (rows: OutboundCallLogRow[]) => {
    this.outbound.push(...rows);
  };
  deleteOlderThan = async () => ({ requestLogs: 0, outboundCallLogs: 0 });
  aggregateInboundByStatusClass = async () => [];
  topRoutesByLatency = async () => [];
  aggregateOutboundByService = async () => [];
  outboundLatencyByService = async () => [];
  errorRateByRoute = async () => [];
  errorRateByService = async () => [];
}

const makeAxiosError = (status: number): AxiosError => {
  const err = new Error(`status ${status}`) as AxiosError;
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

describe('instrumentedAxios', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPublicLookup();
  });

  it('proxies a successful GET to axios.get and records host+pathname (query stripped)', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: 'ok' });

    const url = 'https://api.notion.com/v1/pages/abc?token=secret';
    const result = await client.get('notion', url);

    expect(result).toEqual({ status: 200, data: 'ok' });
    expect(mockedAxios.get).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ lookup: expect.any(Function) })
    );

    await sink.flush();
    expect(repo.outbound).toHaveLength(1);
    expect(repo.outbound[0]).toMatchObject({
      service: 'notion',
      endpoint: 'api.notion.com/v1/pages/abc',
      status_code: 200,
    });
    expect(repo.outbound[0].duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('records non-2xx status from an axios error and rethrows the same error object', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    const err = makeAxiosError(403);
    mockedAxios.get.mockRejectedValueOnce(err);

    await expect(
      client.get('notion', 'https://api.notion.com/v1/pages/abc')
    ).rejects.toBe(err);

    await sink.flush();
    expect(repo.outbound[0].status_code).toBe(403);
  });

  it('records null status_code on network errors (no response)', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    const err = new Error('socket hang up');
    mockedAxios.get.mockRejectedValueOnce(err);

    await expect(
      client.get('notion', 'https://api.notion.com/v1/pages/abc')
    ).rejects.toBe(err);

    await sink.flush();
    expect(repo.outbound[0].status_code).toBeNull();
  });

  it('rejects unknown service names at the wrapper boundary', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    await expect(
      client.get('mystery' as never, 'https://example.com')
    ).rejects.toThrow(/unknown service/i);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('proxies POST/PUT/DELETE and records them too', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.post.mockResolvedValueOnce({ status: 201, data: {} });
    mockedAxios.put.mockResolvedValueOnce({ status: 200, data: {} });
    mockedAxios.delete.mockResolvedValueOnce({ status: 204, data: '' });

    await client.post('claude', 'https://api.anthropic.com/v1/messages', {
      x: 1,
    });
    await client.put(
      'dropbox',
      'https://uc8.dl.dropboxusercontent.com/cd/0/put/abc'
    );
    await client.delete(
      'google_drive',
      'https://www.googleapis.com/drive/v3/files/abc'
    );

    await sink.flush();
    expect(repo.outbound.map((r) => r.service)).toEqual([
      'claude',
      'dropbox',
      'google_drive',
    ]);
    expect(repo.outbound.map((r) => r.status_code)).toEqual([201, 200, 204]);
  });

  it('exposes the closed allowlist as OBSERVABILITY_SERVICES', () => {
    expect(OBSERVABILITY_SERVICES).toEqual(
      expect.arrayContaining([
        'notion',
        'claude',
        'dropbox',
        'google_drive',
        'patreon',
      ])
    );
  });

  it('rejects URLs whose host is not on a fixed-host service allowlist (SSRF guard)', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    await expect(
      client.get('claude', 'https://attacker.example.com/exfil')
    ).rejects.toThrow(/host.*not allowed.*claude/i);
    expect(mockedAxios.get).not.toHaveBeenCalled();

    await expect(
      client.get('google_drive', 'https://evil.com/file')
    ).rejects.toThrow(/host.*not allowed.*google_drive/i);

    await expect(
      client.get('patreon', 'https://api.notion.com/v1/pages/abc')
    ).rejects.toThrow(/host.*not allowed.*patreon/i);
  });

  it('rejects private/loopback hosts on every service (SSRF deny-list)', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    const privateHosts = [
      'https://localhost/internal',
      'https://127.0.0.1/internal',
      'https://10.0.0.1/internal',
      'https://192.168.1.1/internal',
      'https://172.16.0.1/internal',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/internal',
    ];

    for (const url of privateHosts) {
      await expect(client.get('notion', url)).rejects.toThrow(
        /private\/loopback address/i
      );
      await expect(client.get('dropbox', url)).rejects.toThrow(
        /private\/loopback address/i
      );
    }
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('allows arbitrary public hosts for notion media and the dropbox content family', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get.mockResolvedValue({ status: 200, data: 'ok' });

    await expect(
      client.get(
        'notion',
        'https://prod-files-secure.s3.us-west-2.amazonaws.com/abc/def?X-Amz-Signature=xyz'
      )
    ).resolves.toEqual({ status: 200, data: 'ok' });

    await expect(
      client.get(
        'dropbox',
        'https://uc8a13c9bd5f6e64ad7f78a14e0c.dl.dropboxusercontent.com/cd/0/get/abc'
      )
    ).resolves.toEqual({ status: 200, data: 'ok' });
  });

  it('rejects non-https URLs even when the host would otherwise be allowed', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    await expect(
      client.get('notion', 'http://api.notion.com/v1/pages/abc')
    ).rejects.toThrow(/https/i);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('rejects malformed URLs with a clear error before reaching axios', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    await expect(client.get('notion', 'not a url')).rejects.toThrow(
      /invalid url/i
    );
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('accepts every documented production host', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get.mockResolvedValue({ status: 200, data: 'ok' });

    const cases: Array<[Parameters<typeof client.get>[0], string]> = [
      ['notion', 'https://api.notion.com/v1/pages/abc'],
      ['claude', 'https://api.anthropic.com/v1/messages'],
      ['dropbox', 'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc'],
      ['google_drive', 'https://www.googleapis.com/drive/v3/files/abc'],
      ['google_drive', 'https://oauth2.googleapis.com/token'],
      ['patreon', 'https://www.patreon.com/api/oauth2/v2/identity'],
    ];

    for (const [service, url] of cases) {
      await expect(client.get(service, url)).resolves.toEqual({
        status: 200,
        data: 'ok',
      });
    }
  });

  it('rejects IPv4-mapped IPv6 addresses in bracketed form (SSRF bypass)', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    const mappedHosts = [
      'https://[::ffff:127.0.0.1]/internal',
      'https://[::ffff:169.254.169.254]/latest/meta-data',
      'https://[::ffff:10.0.0.1]/internal',
    ];

    for (const url of mappedHosts) {
      await expect(client.get('notion', url)).rejects.toThrow(
        /private\/loopback address/i
      );
      await expect(client.get('dropbox', url)).rejects.toThrow(
        /private\/loopback address/i
      );
    }
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('rejects ULA and link-local IPv6 in bracketed form (SSRF bypass)', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    const hosts = [
      'https://[fc00::1]/internal',
      'https://[fd00::1]/internal',
      'https://[fe80::1]/internal',
    ];

    for (const url of hosts) {
      await expect(client.get('notion', url)).rejects.toThrow(
        /private\/loopback address/i
      );
      await expect(client.get('dropbox', url)).rejects.toThrow(
        /private\/loopback address/i
      );
    }
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('rejects DNS rebinding: public-looking host that resolves to a private IP', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedLookup.mockImplementation(async () => [
      { address: '169.254.169.254', family: 4 },
    ]);

    await expect(
      client.get('notion', 'https://imds.attacker.example/latest/meta-data')
    ).rejects.toThrow(/resolved IP .* is private\/loopback\/link-local/i);

    await expect(
      client.get('dropbox', 'https://rebind.dl.dropboxusercontent.com/file')
    ).rejects.toThrow(/resolved IP .* is private\/loopback\/link-local/i);

    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('rejects DNS rebinding to IPv4-mapped IPv6 address', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedLookup.mockImplementation(async () => [
      { address: '::ffff:169.254.169.254', family: 6 },
    ]);

    await expect(
      client.get('notion', 'https://imds.attacker.example/meta')
    ).rejects.toThrow(/resolved IP .* is private\/loopback\/link-local/i);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('rejects when DNS lookup fails (NXDOMAIN/ENOTFOUND)', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    const dnsErr = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
      code: 'ENOTFOUND',
    });
    mockedLookup.mockImplementation(async () => {
      throw dnsErr;
    });

    await expect(
      client.get('notion', 'https://does-not-exist.invalid/x')
    ).rejects.toThrow(/dns lookup failed|ENOTFOUND/i);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('allows public-resolving hostnames and pins the resolved IP via axios lookup option', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedLookup.mockImplementation(async () => [
      { address: '13.224.0.1', family: 4 },
    ]);
    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: 'ok' });

    await expect(
      client.get(
        'dropbox',
        'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc'
      )
    ).resolves.toEqual({ status: 200, data: 'ok' });

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    const callArgs = mockedAxios.get.mock.calls[0];
    expect(callArgs[1]).toBeDefined();
    const opts = callArgs[1] as { lookup: Function };
    expect(typeof opts.lookup).toBe('function');

    const cb = vi.fn();
    opts.lookup('uc8.dl.dropboxusercontent.com', {}, cb as never);
    expect(cb).toHaveBeenCalledWith(null, '13.224.0.1', 4);
  });

  it('rejects 6to4, documentation, and multicast IPv6 ranges', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    const cases: Array<{ address: string; family: 6 }> = [
      { address: '2002:a9fe:a9fe::1', family: 6 },
      { address: '2001:db8::1', family: 6 },
      { address: 'ff00::1', family: 6 },
      { address: 'fec0::1', family: 6 },
      { address: '::', family: 6 },
    ];

    for (const resolved of cases) {
      mockedLookup.mockImplementationOnce(async () => [resolved]);
      await expect(
        client.get('notion', 'https://anything.example/x')
      ).rejects.toThrow(/private\/loopback\/link-local/i);
    }
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  const makeRedirect = (location: string) => ({
    status: 302,
    data: '',
    headers: { location },
  });

  const makeRedirectError = (location: string): AxiosError => {
    const err = new Error('status 302') as AxiosError;
    err.isAxiosError = true;
    err.response = {
      status: 302,
      statusText: '',
      headers: { location },
      config: {} as never,
      data: null,
    };
    return err;
  };

  it('re-validates a redirect surfaced as an axios error (maxRedirects: 0 production path)', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get.mockRejectedValueOnce(
      makeRedirectError('https://127.0.0.1/internal')
    );
    mockPublicLookup();

    await expect(
      client.get(
        'dropbox',
        'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc'
      )
    ).rejects.toThrow(/private\/loopback address/i);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect surfaced as an axios error to its allowed target', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get
      .mockRejectedValueOnce(
        makeRedirectError('https://uc9.dl.dropboxusercontent.com/cd/0/final')
      )
      .mockResolvedValueOnce({ status: 200, data: 'bytes' });
    mockPublicLookup();

    await expect(
      client.get(
        'dropbox',
        'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc'
      )
    ).resolves.toEqual({ status: 200, data: 'bytes' });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('does not follow a redirect when the caller passes maxRedirects: 0', async () => {
    const client = makeInstrumentedAxios(new ObservabilitySink(new FakeRepo()));
    const redirect = makeRedirectError(
      'https://uc9.dl.dropboxusercontent.com/cd/0/final'
    );
    mockedAxios.get.mockRejectedValueOnce(redirect);
    mockPublicLookup();

    await expect(
      client.get(
        'dropbox',
        'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc',
        { maxRedirects: 0 }
      )
    ).rejects.toBe(redirect);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('rejects a resolved 3xx when the caller passes maxRedirects: 0', async () => {
    const client = makeInstrumentedAxios(new ObservabilitySink(new FakeRepo()));
    mockedAxios.get.mockResolvedValueOnce({
      status: 301,
      headers: { location: 'https://uc9.dl.dropboxusercontent.com/cd/0/x' },
      data: null,
    });
    mockPublicLookup();

    await expect(
      client.get(
        'dropbox',
        'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc',
        { maxRedirects: 0, validateStatus: () => true }
      )
    ).rejects.toThrow(/redirect not followed/i);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('passes maxRedirects: 0 to axios so the wrapper owns redirect following', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: 'ok' });
    mockPublicLookup();

    await client.get(
      'dropbox',
      'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc'
    );

    const opts = mockedAxios.get.mock.calls[0][1] as { maxRedirects: number };
    expect(opts.maxRedirects).toBe(0);
  });

  it('re-validates the redirect target and rejects a hop to a private host', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get.mockResolvedValueOnce(
      makeRedirect('https://rebind.dl.dropboxusercontent.com/file')
    );
    mockedLookup.mockImplementation(async (host: string) => {
      if (host === 'rebind.dl.dropboxusercontent.com') {
        return [{ address: '169.254.169.254', family: 4 }];
      }
      return [{ address: '13.224.0.1', family: 4 }];
    });

    await expect(
      client.get(
        'dropbox',
        'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc'
      )
    ).rejects.toThrow(/private\/loopback\/link-local/i);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('re-validates the redirect target and rejects a hop to an IP-literal private host', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get.mockResolvedValueOnce(
      makeRedirect('https://127.0.0.1/internal')
    );
    mockPublicLookup();

    await expect(
      client.get(
        'dropbox',
        'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc'
      )
    ).rejects.toThrow(/private\/loopback address/i);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('re-validates the redirect target against the service allowlist', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get.mockResolvedValueOnce(
      makeRedirect('https://api.notion.com/v1/pages/abc')
    );
    mockPublicLookup();

    await expect(
      client.get('claude', 'https://api.anthropic.com/v1/messages')
    ).rejects.toThrow(/host.*not allowed.*claude/i);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-https redirect target', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get.mockResolvedValueOnce(
      makeRedirect('http://uc8.dl.dropboxusercontent.com/cd/0/get/abc')
    );
    mockPublicLookup();

    await expect(
      client.get(
        'dropbox',
        'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc'
      )
    ).rejects.toThrow(/https/i);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('follows an allowed redirect hop and returns the final response', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get
      .mockResolvedValueOnce(
        makeRedirect('https://uc9.dl.dropboxusercontent.com/cd/0/final')
      )
      .mockResolvedValueOnce({ status: 200, data: 'bytes' });
    mockPublicLookup();

    await expect(
      client.get(
        'dropbox',
        'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc'
      )
    ).resolves.toEqual({ status: 200, data: 'bytes' });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  const FIXTURE_BASIC_AUTH = {
    username: 'client-id',
    password: ['pl', 'aceholder'].join(''),
  };

  it('strips basic auth and Authorization on a cross-host redirect hop', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get
      .mockResolvedValueOnce(
        makeRedirect('https://uc9.dl.dropboxusercontent.com/cd/0/final')
      )
      .mockResolvedValueOnce({ status: 200, data: 'bytes' });
    mockPublicLookup();

    await client.get(
      'dropbox',
      'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc',
      {
        auth: FIXTURE_BASIC_AUTH,
        headers: { Authorization: 'Bearer tok', 'X-Keep': 'yes' },
      }
    );

    const firstOpts = mockedAxios.get.mock.calls[0][1] as {
      auth?: unknown;
      headers?: Record<string, string>;
    };
    expect(firstOpts.auth).toEqual(FIXTURE_BASIC_AUTH);
    expect(firstOpts.headers?.Authorization).toBe('Bearer tok');

    const hopOpts = mockedAxios.get.mock.calls[1][1] as {
      auth?: unknown;
      headers?: Record<string, string>;
    };
    expect(hopOpts.auth).toBeUndefined();
    expect(hopOpts.headers?.Authorization).toBeUndefined();
    expect(hopOpts.headers?.['X-Keep']).toBe('yes');
  });

  it('keeps auth on a same-host redirect hop', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get
      .mockResolvedValueOnce(
        makeRedirect('https://uc8.dl.dropboxusercontent.com/cd/0/other')
      )
      .mockResolvedValueOnce({ status: 200, data: 'bytes' });
    mockPublicLookup();

    await client.get(
      'dropbox',
      'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc',
      { auth: FIXTURE_BASIC_AUTH }
    );

    const hopOpts = mockedAxios.get.mock.calls[1][1] as { auth?: unknown };
    expect(hopOpts.auth).toEqual(FIXTURE_BASIC_AUTH);
  });

  it('stops following after the redirect cap is exceeded', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockedAxios.get.mockResolvedValue(
      makeRedirect('https://uc9.dl.dropboxusercontent.com/cd/0/loop')
    );
    mockPublicLookup();

    await expect(
      client.get(
        'dropbox',
        'https://uc8.dl.dropboxusercontent.com/cd/0/get/abc'
      )
    ).rejects.toThrow(/too many redirects/i);
  });

  it('constrains the dropbox allowlist to dropboxusercontent content hosts', async () => {
    const repo = new FakeRepo();
    const sink = new ObservabilitySink(repo);
    const client = makeInstrumentedAxios(sink);

    mockPublicLookup();

    await expect(
      client.get('dropbox', 'https://attacker.example.com/exfil')
    ).rejects.toThrow(/host.*not allowed.*dropbox/i);

    await expect(
      client.get('dropbox', 'https://www.dropbox.com/s/abc/file?dl=1')
    ).rejects.toThrow(/host.*not allowed.*dropbox/i);

    expect(mockedAxios.get).not.toHaveBeenCalled();

    mockedAxios.get.mockResolvedValue({ status: 200, data: 'ok' });
    await expect(
      client.get(
        'dropbox',
        'https://uc8a13.dl.dropboxusercontent.com/cd/0/get/abc'
      )
    ).resolves.toEqual({ status: 200, data: 'ok' });
  });

  it('does not throw when sink itself rejects (instrumentation must never break the caller)', async () => {
    const sink = {
      recordOutboundCall: () => {
        throw new Error('boom');
      },
    };
    const client = makeInstrumentedAxios(sink as never);
    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: 'ok' });
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      client.get('notion', 'https://api.notion.com/v1/pages/abc')
    ).resolves.toEqual({ status: 200, data: 'ok' });
    errSpy.mockRestore();
  });
});

describe('instrumentedAxios error redaction', () => {
  let actualAxios: typeof import('axios');

  beforeAll(async () => {
    actualAxios = await vi.importActual<typeof import('axios')>('axios');
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockPublicLookup();
  });

  const CLIENT_ID = 'fixture-client-id';
  const CLIENT_SECRET = ['fixture', 'client', 'secret'].join('-');
  const BEARER_TOKEN = ['fixture', 'bearer', 'token'].join('-');
  const BASIC_CREDENTIAL = Buffer.from(
    `${CLIENT_ID}:${CLIENT_SECRET}`
  ).toString('base64');

  const authorizationLineFor = (config: AxiosRequestConfig): string => {
    if (config.auth != null) {
      const { username, password } = config.auth;
      return `Authorization: Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }
    const headers = (config.headers ?? {}) as Record<string, unknown>;
    return Object.entries(headers)
      .map(([name, value]) => `${name}: ${String(value)}`)
      .join('\r\n');
  };

  const failLikeAxios = (
    status: number,
    responseData: unknown,
    url: string,
    body: unknown,
    config: AxiosRequestConfig
  ): Promise<never> => {
    const internalConfig = {
      ...config,
      url,
      data: body,
      headers: new actualAxios.AxiosHeaders(
        (config.headers ?? {}) as Record<string, string>
      ),
    };
    const request = {
      method: 'POST',
      _header: `POST ${new URL(url).pathname} HTTP/1.1\r\n${authorizationLineFor(config)}\r\n\r\n`,
    };
    const response = {
      status,
      statusText: '',
      headers: {},
      config: internalConfig,
      request,
      data: responseData,
    };
    return Promise.reject(
      new actualAxios.AxiosError(
        `Request failed with status code ${status}`,
        'ERR_BAD_REQUEST',
        internalConfig,
        request,
        response
      )
    );
  };

  const failPostWith = (status: number, responseData: unknown) =>
    mockedAxios.post.mockImplementationOnce((url, body, config) =>
      failLikeAxios(status, responseData, url, body, config ?? {})
    );

  const failGetWith = (status: number, responseData: unknown) =>
    mockedAxios.get.mockImplementationOnce((url, config) =>
      failLikeAxios(status, responseData, url, undefined, config ?? {})
    );

  const captureRejection = async (call: Promise<unknown>): Promise<unknown> => {
    try {
      await call;
    } catch (error) {
      return error;
    }
    throw new Error('expected the request to fail');
  };

  const notionTokenExchange = (
    client: ReturnType<typeof makeInstrumentedAxios>
  ) =>
    client.post(
      'notion',
      'https://api.notion.com/v1/oauth/token',
      { grant_type: 'authorization_code', code: 'fixture-code' },
      {
        auth: { username: CLIENT_ID, password: CLIENT_SECRET },
        headers: { 'Content-Type': 'application/json' },
      }
    );

  it('drops the Basic auth password and credential from a failed request before it reaches the caller', async () => {
    const client = makeInstrumentedAxios(new ObservabilitySink(new FakeRepo()));
    failPostWith(400, { error: 'invalid_grant' });

    const error = await captureRejection(notionTokenExchange(client));

    const printed = inspect(error, { depth: null });
    expect(printed).not.toContain(CLIENT_SECRET);
    expect(printed).not.toContain(BASIC_CREDENTIAL);
  });

  it('keeps the status, code, message and body callers branch on', async () => {
    const client = makeInstrumentedAxios(new ObservabilitySink(new FakeRepo()));
    failPostWith(400, { error: 'invalid_grant' });

    const error = await captureRejection(notionTokenExchange(client));

    expect(actualAxios.isAxiosError(error)).toBe(true);
    expect(error).toMatchObject({
      message: 'Request failed with status code 400',
      code: 'ERR_BAD_REQUEST',
      response: { status: 400, data: { error: 'invalid_grant' } },
    });
  });

  it('leaves the caller-supplied config untouched so a retry still authenticates', async () => {
    const client = makeInstrumentedAxios(new ObservabilitySink(new FakeRepo()));
    failPostWith(503, null);
    const config = {
      auth: { username: CLIENT_ID, password: CLIENT_SECRET },
      headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
    };

    await captureRejection(
      client.post('notion', 'https://api.notion.com/v1/oauth/token', {}, config)
    );

    expect(config).toEqual({
      auth: { username: CLIENT_ID, password: CLIENT_SECRET },
      headers: { Authorization: `Bearer ${BEARER_TOKEN}` },
    });
  });

  it.each(['Authorization', 'authorization', 'Proxy-Authorization'])(
    'drops a bearer token sent in the %s header from a failed request',
    async (headerName) => {
      const client = makeInstrumentedAxios(
        new ObservabilitySink(new FakeRepo())
      );
      failGetWith(403, { error: 'forbidden' });

      const error = await captureRejection(
        client.get(
          'google_drive',
          'https://www.googleapis.com/drive/v3/files/abc',
          { headers: { [headerName]: `Bearer ${BEARER_TOKEN}` } }
        )
      );

      expect(inspect(error, { depth: null })).not.toContain(BEARER_TOKEN);
      expect(actualAxios.isAxiosError(error)).toBe(true);
      expect(error).toMatchObject({ response: { status: 403 } });
    }
  );

  it('drops credentials from an axios error nested as the cause', async () => {
    const client = makeInstrumentedAxios(new ObservabilitySink(new FakeRepo()));
    mockedAxios.post.mockImplementationOnce((url, body, config) =>
      failLikeAxios(400, null, url, body, config ?? {}).catch((inner) => {
        const outer = new actualAxios.AxiosError(
          'maxBodyLength size of 1 exceeded',
          'ERR_FR_MAX_BODY_LENGTH_EXCEEDED',
          inner.config
        );
        outer.cause = inner;
        return Promise.reject(outer);
      })
    );

    const error = await captureRejection(notionTokenExchange(client));

    const printed = inspect(error, { depth: null });
    expect(printed).not.toContain(CLIENT_SECRET);
    expect(printed).not.toContain(BASIC_CREDENTIAL);
  });

  it('drops a client secret sent in a form-encoded request body from a failed request', async () => {
    const client = makeInstrumentedAxios(new ObservabilitySink(new FakeRepo()));
    failPostWith(400, { error: 'invalid_client' });

    const error = await captureRejection(
      client.post(
        'microsoft_login',
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`,
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      )
    );

    expect(inspect(error, { depth: null })).not.toContain(CLIENT_SECRET);
    expect(error).toMatchObject({
      response: { status: 400, data: { error: 'invalid_client' } },
    });
  });
});
