import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

vi.mock('../data_layer', () => ({
  getDatabase: vi.fn(() => ({})),
}));

vi.mock('../services/events/eventsSinkInstance', () => ({
  getEventsSink: vi.fn(() => ({ recordEvent: vi.fn() })),
}));

vi.mock('../usecases/events/IngestErrorEventUseCase', () => ({
  IngestErrorEventUseCase: class {
    async execute() {
      return 'accepted';
    }
  },
}));

vi.mock('../data_layer/ErrorEventRepository', () => ({
  ErrorEventRepository: class {
    async insert() {}
    async existsWithinWindow() {
      return false;
    }
    async listGroups() {
      return [];
    }
    async countGroups() {
      return 0;
    }
  },
}));

import EventsRouter from './EventsRouter';

const VALID_PAYLOAD = {
  message: 'TypeError: Cannot read properties of null',
  stack: 'at App.tsx:12',
  url: 'https://2anki.net',
  userAgent: 'Mozilla/5.0',
  release: 'abc12345678901234567890123456789012345678',
};

const startServer = async () => {
  const app = express();
  app.use(express.json({ limit: '11kb' }));
  app.use(EventsRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

describe('EventsRouter POST /api/events/errors', () => {
  it('returns 202 on a valid payload', async () => {
    const { url, close } = await startServer();
    try {
      const res = await fetch(`${url}/api/events/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_PAYLOAD),
      });
      expect(res.status).toBe(202);
    } finally {
      await close();
    }
  });

  it('returns 400 on a malformed payload (no message)', async () => {
    const { url, close } = await startServer();
    try {
      const res = await fetch(`${url}/api/events/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stack: 'some stack' }),
      });
      expect(res.status).toBe(400);
    } finally {
      await close();
    }
  });

  it('returns 413 on an oversized payload', async () => {
    const { url, close } = await startServer();
    try {
      const bigMessage = 'x'.repeat(11_000);
      const res = await fetch(`${url}/api/events/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: bigMessage }),
      });
      expect(res.status).toBe(413);
    } finally {
      await close();
    }
  });

  it('does not include ip_hash in the response', async () => {
    const { url, close } = await startServer();
    try {
      const res = await fetch(`${url}/api/events/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(VALID_PAYLOAD),
      });
      const text = await res.text();
      expect(text).not.toContain('ip_hash');
    } finally {
      await close();
    }
  });
});
