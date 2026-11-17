import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { clientGoneSignal } from './clientGoneSignal';

async function withServer(
  handler: express.RequestHandler,
  run: (base: string) => Promise<void>
): Promise<void> {
  const app = express();
  app.get('/slow', handler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('clientGoneSignal', () => {
  it('aborts when the client disconnects before the answer is sent', async () => {
    let signal: AbortSignal | undefined;

    await withServer(
      (_req, res) => {
        signal = clientGoneSignal(res);
      },
      async (base) => {
        const client = new AbortController();
        const request = fetch(`${base}/slow`, { signal: client.signal }).catch(
          () => undefined
        );
        await vi.waitFor(() => expect(signal).toBeDefined());
        client.abort();
        await request;
        await vi.waitFor(() => expect(signal?.aborted).toBe(true));
      }
    );
  });

  it('does not abort once the answer has been sent', async () => {
    let signal: AbortSignal | undefined;

    await withServer(
      (_req, res) => {
        signal = clientGoneSignal(res);
        res.json({ ok: true });
      },
      async (base) => {
        const res = await fetch(`${base}/slow`);
        expect(await res.json()).toEqual({ ok: true });
      }
    );

    expect(signal?.aborted).toBe(false);
  });
});
