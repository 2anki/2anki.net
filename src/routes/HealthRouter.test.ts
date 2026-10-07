import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Knex } from 'knex';

vi.mock('../services/NotionService/NotionCallRingBuffer', () => ({
  notionCallRingBuffer: {
    lastSuccessAt: vi.fn(() => null),
  },
}));

vi.mock('../services/stripeWebhookTimestamp', () => ({
  getLastStripeWebhookAt: vi.fn(() => null),
}));

vi.mock('fs', async () => ({
  ...(await vi.importActual<typeof import('fs')>('fs')),
  readFileSync: vi.fn(() => '[]'),
}));

function makeTestDb(dbOk = true) {
  return {
    raw: vi.fn(async () => {
      if (dbOk) return [{ '1': 1 }];
      throw new Error('db down');
    }),
  } as unknown as Knex;
}

async function buildServer(db = makeTestDb()) {
  const { default: HealthRouter } = await import('./HealthRouter');
  const app = express();
  app.use(HealthRouter(db));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe('GET /api/health', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  it('returns ok: true with uptime and version', async () => {
    const res = await fetch(`${url}/api/health`);
    const body = (await res.json()) as { ok: boolean; uptime: number };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.uptime).toBe('number');
  });
});

describe('GET /api/health/db', () => {
  it('returns ok: true when db is reachable', async () => {
    const { server, url } = await buildServer(makeTestDb(true));
    try {
      const res = await fetch(`${url}/api/health/db`);
      const body = (await res.json()) as { ok: boolean };
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
    } finally {
      server.close();
    }
  });

  it('returns 503 when db is unreachable', async () => {
    const { server, url } = await buildServer(makeTestDb(false));
    try {
      const res = await fetch(`${url}/api/health/db`);
      const body = (await res.json()) as { ok: boolean };
      expect(res.status).toBe(503);
      expect(body.ok).toBe(false);
    } finally {
      server.close();
    }
  });
});

describe('GET /api/status', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  it('returns the five signal shape', async () => {
    const res = await fetch(`${url}/api/status`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      api: { ok: true },
      db: { ok: true },
      notion: { ok: false, lastSuccessAt: null },
      stripe: { lastWebhookAt: null },
      lastDeploy: { sha: null, time: null },
      incidents: [],
    });
  });

  it('reflects a db failure in the status', async () => {
    const { server: s, url: u } = await buildServer(makeTestDb(false));
    try {
      const res = await fetch(`${u}/api/status`);
      const body = (await res.json()) as { db: { ok: boolean } };
      expect(body.db).toEqual({ ok: false });
    } finally {
      s.close();
    }
  });
});
