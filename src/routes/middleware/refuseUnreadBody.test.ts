import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  headerOf,
  jsonBodyOf,
  sendRawHttpRequest,
  statusOf,
} from '../../test/rawHttpRequest';
import { refuseUnreadBody } from './refuseUnreadBody';

const REFUSAL = { message: 'Authentication required' };

async function withRefusingServer<T>(
  limits: { maxBytes: number; maxMs: number },
  run: (port: number) => Promise<T>
): Promise<T> {
  const app = express();
  app.use(express.json());
  app.post('/refuse', (req, res) =>
    refuseUnreadBody(req, res, 401, REFUSAL, limits)
  );
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('refuseUnreadBody', () => {
  it('answers at once when there is no body to read', async () => {
    const result = await withRefusingServer(
      { maxBytes: 1024, maxMs: 5_000 },
      (port) =>
        sendRawHttpRequest({
          port,
          head: 'POST /refuse HTTP/1.1\r\nHost: x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n',
          chunks: [],
        })
    );

    expect(statusOf(result.response)).toBe(401);
    expect(jsonBodyOf(result.response)).toEqual(REFUSAL);
  });

  it('answers a JSON body the parser already read without closing the connection', async () => {
    const payload = JSON.stringify({ link: 'x'.repeat(4096) });
    const response = await withRefusingServer(
      { maxBytes: 1024, maxMs: 5_000 },
      (port) =>
        fetch(`http://127.0.0.1:${port}/refuse`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('connection')).not.toBe('close');
    expect(await response.json()).toEqual(REFUSAL);
  });

  it('stops waiting for a body that trickles in past the time limit and closes', async () => {
    const declared = 64 * 1024;
    const result = await withRefusingServer(
      { maxBytes: 1024 * 1024, maxMs: 200 },
      (port) =>
        sendRawHttpRequest({
          port,
          head: `POST /refuse HTTP/1.1\r\nHost: x\r\nContent-Type: application/octet-stream\r\nContent-Length: ${declared}\r\n\r\n`,
          chunks: Array.from({ length: 64 }, () => Buffer.alloc(1024, 97)),
          chunkDelayMs: 50,
          stopWritingOnResponse: true,
        })
    );

    expect(result.timedOut).toBe(false);
    expect(statusOf(result.response)).toBe(401);
    expect(headerOf(result.response, 'Connection')).toBe('close');
    expect(jsonBodyOf(result.response)).toEqual(REFUSAL);
    expect(result.bytesSent).toBeLessThan(declared);
  });
});
