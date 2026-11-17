import { vi } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

import { buildTinyApkg } from '../test/fixtures/apkg/buildTinyApkg';

const send = vi.hoisted(() => vi.fn());
const getFile = vi.hoisted(() => vi.fn());

vi.mock('@aws-sdk/client-s3', async () => {
  const actual =
    await vi.importActual<typeof import('@aws-sdk/client-s3')>(
      '@aws-sdk/client-s3'
    );
  return {
    ...actual,
    S3Client: vi.fn().mockImplementation(function () {
      return { send };
    }),
  };
});

vi.mock('../data_layer', () => ({
  getDatabase: vi.fn().mockReturnValue({}),
}));

vi.mock('../data_layer/DownloadRepository', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return {
      getFile,
      getFilename: vi.fn().mockResolvedValue('deck.apkg'),
    };
  }),
}));

vi.mock('../services/events/track', () => ({ track: vi.fn() }));

vi.mock('./middleware/RequireAuthentication', () => {
  const signedIn = (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void
  ) => {
    res.locals.owner = 7;
    next();
  };
  return {
    __esModule: true,
    default: signedIn,
    RequireAuthenticationOrLogin: signedIn,
  };
});

import ApkgRouter from './ApkgRouter';
import DownloadRouter from './DownloadRouter';
import {
  COLD_LOAD_BUDGET_BYTES,
  PREVIEW_MAX_STORED_BYTES,
  resetPreviewMemoryLimitsForTesting,
  sharedPreviewLimits,
} from '../services/ApkgPreviewService/previewMemoryLimits';

const MIB = 1024 * 1024;
const STORED_KEY = 'stored/7/deck.apkg';

let spoolBase: string;

beforeEach(() => {
  resetPreviewMemoryLimitsForTesting();
  spoolBase = fs.mkdtempSync(path.join(os.tmpdir(), 'stored-preview-spool-'));
  process.env.WORKSPACE_BASE = spoolBase;
  process.env.SPACES_DEFAULT_BUCKET_NAME = 'test-bucket';
  process.env.SPACES_ENDPOINT = 'https://test.spaces.example.com';
  send.mockReset();
  getFile.mockReset().mockResolvedValue({ key: STORED_KEY });
});

afterEach(() => {
  fs.rmSync(spoolBase, { recursive: true, force: true });
});

function storedBody(bytes: Buffer) {
  return Object.assign(Readable.from([bytes]), {
    transformToByteArray: async () => new Uint8Array(bytes),
  });
}

function storageReports(size: number) {
  const bytes = buildTinyApkg();
  send.mockImplementation(async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      return { ContentLength: size };
    }
    if (command instanceof GetObjectCommand) {
      return { Body: storedBody(bytes) };
    }
    throw new Error('unexpected storage command');
  });
  return bytes;
}

function storageCalls(
  type: typeof HeadObjectCommand | typeof GetObjectCommand
) {
  return send.mock.calls.filter(([command]) => command instanceof type).length;
}

async function withServer<T>(run: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use(ApkgRouter());
  app.use(DownloadRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function postEdited(base: string): Promise<Response> {
  return fetch(`${base}/api/apkg/deck.apkg/download-edited`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edits: [] }),
  });
}

describe('ApkgRouter stored deck preview', () => {
  it('previews a normal deck after checking its size', async () => {
    storageReports(4096);

    const res = await withServer((base) =>
      fetch(`${base}/api/apkg/deck.apkg/meta`)
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ totalCards: 1 });
    expect(storageCalls(HeadObjectCommand)).toBe(1);
    expect(storageCalls(GetObjectCommand)).toBe(1);
  });

  it('previews a 200 MiB deck', async () => {
    storageReports(200 * MIB);

    const res = await withServer((base) =>
      fetch(`${base}/api/apkg/deck.apkg/cards`)
    );

    expect(res.status).toBe(200);
    expect((await res.json()).total).toBe(1);
    expect(storageCalls(GetObjectCommand)).toBe(1);
  });

  it('still reads a deck exactly at the size limit', async () => {
    storageReports(PREVIEW_MAX_STORED_BYTES);

    const res = await withServer((base) =>
      fetch(`${base}/api/apkg/deck.apkg/cards`)
    );

    expect(res.status).toBe(200);
    expect((await res.json()).total).toBe(1);
    expect(storageCalls(GetObjectCommand)).toBe(1);
  });

  it('refuses a deck over the size limit with 413 and never requests its body', async () => {
    storageReports(PREVIEW_MAX_STORED_BYTES + 1);

    const [meta, cards] = await withServer(async (base) => [
      await fetch(`${base}/api/apkg/deck.apkg/meta`),
      await fetch(`${base}/api/apkg/deck.apkg/cards`),
    ]);

    expect(meta.status).toBe(413);
    expect(await meta.json()).toEqual({
      message: 'This Anki package is too large to process.',
    });
    expect(cards.status).toBe(413);
    expect(storageCalls(GetObjectCommand)).toBe(0);
  });

  it.each(['meta', 'cards', 'media/picture.png'])(
    'refuses a 300 MiB deck with 413 and never requests its body (%s)',
    async (route) => {
      storageReports(300 * MIB);

      const res = await withServer((base) =>
        fetch(`${base}/api/apkg/deck.apkg/${route}`)
      );

      expect(res.status).toBe(413);
      expect(storageCalls(GetObjectCommand)).toBe(0);
    }
  );

  it.each(['meta', 'cards', 'media/picture.png'])(
    'serves 404 for a deck deleted after it was cached (%s)',
    async (route) => {
      storageReports(4096);

      const statuses = await withServer(async (base) => {
        const first = await fetch(`${base}/api/apkg/deck.apkg/${route}`);
        getFile.mockResolvedValue(null);
        const afterDelete = await fetch(`${base}/api/apkg/deck.apkg/${route}`);
        return [first.status, afterDelete.status];
      });

      expect(statuses).toEqual([200, 404]);
      expect(storageCalls(GetObjectCommand)).toBe(1);
    }
  );

  it('answers a cached deck without going back to storage', async () => {
    storageReports(4096);

    const statuses = await withServer(async (base) => [
      (await fetch(`${base}/api/apkg/deck.apkg/meta`)).status,
      (await fetch(`${base}/api/apkg/deck.apkg/cards`)).status,
      (await fetch(`${base}/api/apkg/deck.apkg/media/missing.png`)).status,
    ]);

    expect(statuses).toEqual([200, 200, 404]);
    expect(storageCalls(HeadObjectCommand)).toBe(1);
    expect(storageCalls(GetObjectCommand)).toBe(1);
  });

  it('reads the deck once for eight concurrent previews of it', async () => {
    storageReports(4096);

    const statuses = await withServer((base) =>
      Promise.all(
        Array.from({ length: 8 }, async (_, i) => {
          const route = i % 2 === 0 ? 'meta' : 'cards';
          return (await fetch(`${base}/api/apkg/deck.apkg/${route}`)).status;
        })
      )
    );

    expect(statuses).toEqual(Array(8).fill(200));
    expect(storageCalls(GetObjectCommand)).toBe(1);
  });

  it('answers 404 for a deck the owner does not have, without touching storage', async () => {
    getFile.mockResolvedValue(null);
    storageReports(4096);

    const res = await withServer((base) =>
      fetch(`${base}/api/apkg/deck.apkg/meta`)
    );

    expect(res.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 404 when the stored object is gone', async () => {
    send.mockRejectedValue(
      Object.assign(new Error('UnknownError'), {
        name: 'NotFound',
        $metadata: { httpStatusCode: 404 },
      })
    );

    const res = await withServer((base) =>
      fetch(`${base}/api/apkg/deck.apkg/meta`)
    );

    expect(res.status).toBe(404);
    expect(storageCalls(GetObjectCommand)).toBe(0);
  });
});

describe('ApkgRouter edited deck download', () => {
  it('repacks a 200 MiB deck with its edits', async () => {
    storageReports(200 * MIB);

    const res = await withServer(postEdited);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(
      'deck-edited.apkg'
    );
    expect(storageCalls(GetObjectCommand)).toBe(1);
  });

  it('refuses to repack a 300 MiB deck with 413 and never requests its body', async () => {
    storageReports(300 * MIB);

    const res = await withServer(postEdited);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      message: 'This Anki package is too large to process.',
    });
    expect(storageCalls(GetObjectCommand)).toBe(0);
  });

  it('waits for room under the shared cold-load limit before reading the deck', async () => {
    storageReports(4096);
    const release = await sharedPreviewLimits().coldLoads.acquire(
      COLD_LOAD_BUDGET_BYTES
    );

    const status = await withServer(async (base) => {
      const pending = postEdited(base);
      await vi.waitFor(() =>
        expect(sharedPreviewLimits().coldLoads.waiting).toBe(1)
      );
      expect(storageCalls(GetObjectCommand)).toBe(0);
      release();
      return (await pending).status;
    });

    expect(status).toBe(200);
    expect(storageCalls(GetObjectCommand)).toBe(1);
    expect(sharedPreviewLimits().coldLoads.inUse).toBe(0);
  });
});

describe('ApkgRouter stored deck too large to preview', () => {
  it('still downloads a 300 MiB deck the preview refuses', async () => {
    const bytes = storageReports(300 * MIB);

    const [preview, download] = await withServer(async (base) => [
      await fetch(`${base}/api/apkg/deck.apkg/meta`),
      await fetch(`${base}/api/download/u/deck.apkg`),
    ]);

    expect(preview.status).toBe(413);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('deck.apkg');
    expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes);
  });
});
