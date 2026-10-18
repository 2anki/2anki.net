import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import wellKnownRouter from './WellKnownRouter';

async function get(path: string) {
  const app = express();
  app.use(wellKnownRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`);
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: await response.text(),
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('GET /.well-known/openai-apps-challenge', () => {
  const original = process.env.OPENAI_APPS_CHALLENGE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.OPENAI_APPS_CHALLENGE;
    } else {
      process.env.OPENAI_APPS_CHALLENGE = original;
    }
  });

  it('serves the configured token as plain text and nothing else', async () => {
    process.env.OPENAI_APPS_CHALLENGE = 'challenge-token-123';

    const response = await get('/.well-known/openai-apps-challenge');

    expect(response.status).toBe(200);
    expect(response.contentType).toBe('text/plain; charset=utf-8');
    expect(response.body).toBe('challenge-token-123');
  });

  it('trims surrounding whitespace from the configured token', async () => {
    process.env.OPENAI_APPS_CHALLENGE = '  challenge-token-123\n';

    const response = await get('/.well-known/openai-apps-challenge');

    expect(response.body).toBe('challenge-token-123');
  });

  it.each([undefined, '', '   '])(
    'returns 404 when the token is %j',
    async (value) => {
      if (value === undefined) {
        delete process.env.OPENAI_APPS_CHALLENGE;
      } else {
        process.env.OPENAI_APPS_CHALLENGE = value;
      }

      const response = await get('/.well-known/openai-apps-challenge');

      expect(response.status).toBe(404);
    }
  );
});
