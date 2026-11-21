import { vi, type Mock, type Mocked } from 'vitest';
import axios, { AxiosError, type AxiosStatic } from 'axios';
import dns from 'dns';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

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
    AxiosError: actual.AxiosError,
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

  it('asks the shared client for the first byte, with a deadline signal and a 64 KB cap', async () => {
    respondWith({ 'content-type': 'image/png' }, Buffer.from([0x89]));

    await resolveIconThroughSharedClient(ICON_URL, PNG_TYPES);

    expect(mockedAxios.get).toHaveBeenCalledWith(
      ICON_URL,
      expect.objectContaining({
        headers: { Range: 'bytes=0-0' },
        maxContentLength: 64 * 1024,
        signal: expect.any(AbortSignal),
        lookup: expect.any(Function),
      })
    );
  });

  it('ends a fetch that is still running at 5 s and leaves the icon out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let signal: AbortSignal | undefined;
      mockedAxios.get.mockImplementationOnce((_url, config) => {
        signal = config?.signal as AbortSignal;
        return new Promise(() => undefined);
      });

      const pending = resolveIconThroughSharedClient(ICON_URL, PNG_TYPES);
      await vi.advanceTimersByTimeAsync(5000);

      await expect(pending).resolves.toBeUndefined();
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('against a local server that ignores the range header and never ends the body', () => {
    const ICON_CAP = 64 * 1024;
    const ONE_SOCKET_READ = 64 * 1024;
    const FRAMING_SLACK = 8 * 1024;
    let server: http.Server;
    let clientDisconnected: Promise<void>;
    let clientSockets: Socket[];
    let clientError: unknown;

    const streamWithoutEnd = (res: http.ServerResponse) => {
      const chunk = Buffer.alloc(16 * 1024, 0x89);
      const writeUntilBackpressure = () => {
        while (!res.destroyed) {
          if (!res.write(chunk)) {
            res.once('drain', writeUntilBackpressure);
            return;
          }
        }
      };
      writeUntilBackpressure();
    };

    beforeEach(async () => {
      clientSockets = [];
      clientError = undefined;
      clientDisconnected = new Promise((resolve) => {
        server = http.createServer((_req, res) => {
          res.on('close', () => resolve());
          res.writeHead(200, { 'content-type': 'image/png' });
          streamWithoutEnd(res);
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
      );
      const { port } = server.address() as AddressInfo;
      const countingAgent = new http.Agent({ keepAlive: false });
      const createConnection =
        countingAgent.createConnection.bind(countingAgent);
      countingAgent.createConnection = (options, callback) => {
        const socket = createConnection(options, callback) as Socket;
        clientSockets.push(socket);
        return socket;
      };
      const { default: realAxios } = await vi.importActual<{
        default: AxiosStatic;
      }>('axios');
      mockedAxios.get.mockImplementation((url, config) => {
        const { lookup: _lookup, ...rest } = config ?? {};
        const { pathname } = new URL(url);
        return realAxios
          .get(`http://127.0.0.1:${port}${pathname}`, {
            ...rest,
            httpAgent: countingAgent,
          })
          .catch((error: unknown) => {
            clientError = error;
            throw error;
          });
      });
    });

    afterEach(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });

    it('stops reading at the 64 KB cap, disconnects, and leaves the icon out', async () => {
      const result = await resolveIconThroughSharedClient(ICON_URL, PNG_TYPES);

      expect(result).toBeUndefined();
      expect(clientError).toBeInstanceOf(AxiosError);
      expect((clientError as AxiosError).code).toBe(
        AxiosError.ERR_BAD_RESPONSE
      );
      expect((clientError as AxiosError).response).toBeUndefined();
      await clientDisconnected;
      expect(clientSockets).toHaveLength(1);
      expect(clientSockets[0].bytesRead).toBeGreaterThan(ICON_CAP);
      expect(clientSockets[0].bytesRead).toBeLessThanOrEqual(
        ICON_CAP + ONE_SOCKET_READ + FRAMING_SLACK
      );
    });
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
      '[bookmark-icon] shared client refused 1 icon URL'
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
