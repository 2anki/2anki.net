import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

vi.mock('../data_layer', () => ({
  getDatabase: vi.fn(() => ({})),
}));

vi.mock('./middleware/RequireOpsAccess', () => {
  type State = { allow: boolean };
  const state = globalThis as unknown as { __opsErrorsState?: State };
  if (state.__opsErrorsState == null) {
    state.__opsErrorsState = { allow: false };
  }
  const shared = state.__opsErrorsState;
  return {
    __esModule: true,
    default: (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (!shared.allow) {
        res.status(401).end();
        return;
      }
      next();
    },
  };
});

const resolveGroupSpy = vi.fn(async () => {});
const reopenGroupSpy = vi.fn(async () => {});
const listGroupsSpy = vi.fn();

vi.mock('../data_layer/ErrorEventRepository', () => ({
  ErrorEventRepository: class {
    async listGroups(options: unknown) {
      listGroupsSpy(options);
      return [
        {
          message_hash: 'a'.repeat(64),
          message: 'TypeError: x is null',
          stack: 'at App.tsx:10',
          url: 'https://2anki.net',
          release: 'abc12345',
          source: 'web',
          user_id: null,
          user_agent: 'Mozilla/5.0',
          first_seen: '2026-05-01T00:00:00.000Z',
          last_seen: '2026-05-24T10:00:00.000Z',
          occurrences: 3,
          resolved: false,
          resolved_at: null,
        },
      ];
    }
    async countGroups() {
      return 1;
    }
    async latestSamples() {
      return [
        {
          message_hash: 'a'.repeat(64),
          stack: 'at App.tsx:10',
          url: 'https://2anki.net',
          user_agent: 'Mozilla/5.0',
          release: 'abc12345',
          user_id: 21770,
        },
      ];
    }
    async insert() {}
    async existsWithinWindow() {
      return false;
    }
    resolveGroup(...args: unknown[]) {
      return resolveGroupSpy(...(args as []));
    }
    reopenGroup(...args: unknown[]) {
      return reopenGroupSpy(...(args as []));
    }
  },
}));

import OpsErrorsRouter from './OpsErrorsRouter';

type GlobalWithState = { __opsErrorsState: { allow: boolean } };
const opsErrorsState = (globalThis as unknown as GlobalWithState)
  .__opsErrorsState;

const startServer = async (allowOps: boolean) => {
  opsErrorsState.allow = allowOps;
  const app = express();
  app.use(OpsErrorsRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

describe('OpsErrorsRouter GET /api/ops/errors', () => {
  it('returns 401 without admin auth', async () => {
    const { url, close } = await startServer(false);
    try {
      const res = await fetch(`${url}/api/ops/errors`);
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('returns 200 with the groups shape for the ops owner', async () => {
    const { url, close } = await startServer(true);
    try {
      const res = await fetch(`${url}/api/ops/errors`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        groups: expect.any(Array),
        totalGroups: expect.any(Number),
      });
    } finally {
      await close();
    }
  });

  it('does not expose ip_hash in the response', async () => {
    const { url, close } = await startServer(true);
    try {
      const res = await fetch(`${url}/api/ops/errors`);
      const text = await res.text();
      expect(text).not.toContain('ip_hash');
    } finally {
      await close();
    }
  });

  it('returns groups with the expected shape', async () => {
    const { url, close } = await startServer(true);
    try {
      const res = await fetch(`${url}/api/ops/errors`);
      const body = (await res.json()) as { groups: unknown[] };
      expect(body.groups[0]).toMatchObject({
        message_hash: expect.any(String),
        message: expect.any(String),
        source: expect.any(String),
        first_seen: expect.any(String),
        last_seen: expect.any(String),
        occurrences: expect.any(Number),
        resolved: expect.any(Boolean),
      });
    } finally {
      await close();
    }
  });
});

describe('OpsErrorsRouter GET /api/ops/errors/export', () => {
  beforeEach(() => {
    listGroupsSpy.mockClear();
  });

  it('returns 401 without admin auth', async () => {
    const { url, close } = await startServer(false);
    try {
      const res = await fetch(`${url}/api/ops/errors/export`);
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('returns a markdown attachment with group and sample detail', async () => {
    const { url, close } = await startServer(true);
    try {
      const res = await fetch(`${url}/api/ops/errors/export`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/markdown');
      expect(res.headers.get('content-disposition')).toMatch(
        /^attachment; filename="2anki-errors-\d{4}-\d{2}-\d{2}\.md"$/
      );
      const body = await res.text();
      expect(body).toContain(
        'Investigate these production error groups from 2anki.net.'
      );
      expect(body).toContain('TypeError: x is null');
      expect(body).toContain('- Occurrences: 3');
      expect(body).toContain('at App.tsx:10');
    } finally {
      await close();
    }
  });

  it('respects the status filter', async () => {
    const { url, close } = await startServer(true);
    try {
      await fetch(`${url}/api/ops/errors/export?status=resolved`);
      expect(listGroupsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'resolved' })
      );
    } finally {
      await close();
    }
  });

  it('respects the source filter', async () => {
    const { url, close } = await startServer(true);
    try {
      await fetch(`${url}/api/ops/errors/export?source=server`);
      expect(listGroupsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'server' })
      );
    } finally {
      await close();
    }
  });

  it('never includes ip_hash in the export', async () => {
    const { url, close } = await startServer(true);
    try {
      const res = await fetch(`${url}/api/ops/errors/export`);
      const body = await res.text();
      expect(body).not.toContain('ip_hash');
    } finally {
      await close();
    }
  });
});

describe('OpsErrorsRouter resolve / reopen', () => {
  const hash = 'a'.repeat(64);

  beforeEach(() => {
    resolveGroupSpy.mockClear();
    reopenGroupSpy.mockClear();
  });

  it('returns 401 on resolve without admin auth', async () => {
    const { url, close } = await startServer(false);
    try {
      const res = await fetch(`${url}/api/ops/errors/${hash}/resolve`, {
        method: 'POST',
      });
      expect(res.status).toBe(401);
      expect(resolveGroupSpy).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('resolves a group for the ops owner', async () => {
    const { url, close } = await startServer(true);
    try {
      const res = await fetch(`${url}/api/ops/errors/${hash}/resolve`, {
        method: 'POST',
      });
      expect(res.status).toBe(204);
      expect(resolveGroupSpy).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });

  it('rejects an invalid hash with 400', async () => {
    const { url, close } = await startServer(true);
    try {
      const res = await fetch(`${url}/api/ops/errors/not-a-hash/resolve`, {
        method: 'POST',
      });
      expect(res.status).toBe(400);
      expect(resolveGroupSpy).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it('reopens a group via DELETE for the ops owner', async () => {
    const { url, close } = await startServer(true);
    try {
      const res = await fetch(`${url}/api/ops/errors/${hash}/resolve`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(204);
      expect(reopenGroupSpy).toHaveBeenCalledTimes(1);
    } finally {
      await close();
    }
  });
});
