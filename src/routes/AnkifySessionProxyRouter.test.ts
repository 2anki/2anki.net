import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

const capturedOptions: { value: Record<string, unknown> | null } = {
  value: null,
};

vi.mock('http-proxy-middleware', () => {
  const middleware = Object.assign(
    vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
    { upgrade: vi.fn() }
  );
  return {
    createProxyMiddleware: vi.fn((options: Record<string, unknown>) => {
      capturedOptions.value = options;
      return middleware;
    }),
  };
});

import { attachAnkifySessionProxy } from './AnkifySessionProxyRouter';
import { ValidateAnkifySessionTokenUseCase } from '../usecases/ankify/ValidateAnkifySessionTokenUseCase';

const VALID_TOKEN = 'A'.repeat(43);

const makeFakeValidate = (port: number) =>
  ({
    execute: async () => ({ ok: true as const, novnc_port: port }),
  }) as unknown as ValidateAnkifySessionTokenUseCase;

const makeRejectingValidate = (reason = 'invalid_session_token') =>
  ({
    execute: async () => ({ ok: false as const, status: 401 as const, reason }),
  }) as unknown as ValidateAnkifySessionTokenUseCase;

const requestViaListen = (
  app: express.Express,
  attach: (server: http.Server) => void,
  path: string,
  headers: Record<string, string> = {}
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> =>
  new Promise((resolve, reject) => {
    const server = http.createServer(app);
    attach(server);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const req = http.request(
        { host: '127.0.0.1', port, path, method: 'GET', headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            server.close();
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        }
      );
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });

describe('attachAnkifySessionProxy', () => {
  beforeEach(() => {
    capturedOptions.value = null;
  });

  test('does not pass ws:true to the proxy (would race with our upgrade handler)', () => {
    const app = express();
    const server = http.createServer(app);
    attachAnkifySessionProxy(app, server, makeFakeValidate(54321));

    expect(capturedOptions.value).not.toBeNull();
    expect(capturedOptions.value?.ws).not.toBe(true);
  });

  test('registers exactly one upgrade handler on the http server', () => {
    const app = express();
    const server = http.createServer(app);
    attachAnkifySessionProxy(app, server, makeFakeValidate(54321));

    expect(server.listenerCount('upgrade')).toBe(1);
  });

  test('upgrade handler validates and forwards to proxy.upgrade with port set', async () => {
    const app = express();
    const server = http.createServer(app);
    attachAnkifySessionProxy(app, server, makeFakeValidate(54321));

    const upgradeListeners = server.listeners('upgrade') as ((
      req: http.IncomingMessage,
      socket: unknown,
      head: Buffer
    ) => Promise<void>)[];
    const ourHandler = upgradeListeners[0];

    const req = {
      url: `/v/${VALID_TOKEN}/websockify`,
      headers: { cookie: 'token=abc' },
    } as unknown as http.IncomingMessage;
    const socket = { destroy: vi.fn() };
    const head = Buffer.alloc(0);

    await ourHandler(req, socket, head);

    expect(
      (req as unknown as { __ankifyNovncPort: number }).__ankifyNovncPort
    ).toBe(54321);
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  test('HTML GETs that fail validation get a 302 to /ankify so the user lands somewhere useful', async () => {
    const app = express();
    const validate = makeRejectingValidate('invalid_session_token');
    const result = await requestViaListen(
      app,
      (server) => attachAnkifySessionProxy(app, server, validate),
      `/v/${VALID_TOKEN}/vnc.html`,
      { Accept: 'text/html,application/xhtml+xml' }
    );

    expect(result.status).toBe(302);
    expect(result.headers.location).toBe(
      '/ankify?session_expired=1&reason=invalid_session_token'
    );
  });

  test('non-HTML requests still get the JSON 401 (websockify, fetch, etc.)', async () => {
    const app = express();
    const validate = makeRejectingValidate('invalid_session_token');
    const result = await requestViaListen(
      app,
      (server) => attachAnkifySessionProxy(app, server, validate),
      `/v/${VALID_TOKEN}/websockify`,
      { Accept: 'application/json' }
    );

    expect(result.status).toBe(401);
    expect(result.body).toBe(
      JSON.stringify({ message: 'invalid_session_token' })
    );
  });
});
