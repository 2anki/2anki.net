import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

import { buildTinyApkg } from '../test/fixtures/apkg/buildTinyApkg';
import { MAX_TOTAL_DECOMPRESSED_BYTES } from '../services/ApkgPreviewService/extractApkg';

const send = vi.hoisted(() => vi.fn());
const findByToken = vi.hoisted(() => vi.fn());
const pinSharedNoteTypes = vi.hoisted(() => vi.fn());

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

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi
    .fn()
    .mockResolvedValue('https://storage.example.com/signed-deck'),
}));

vi.mock('../lib/anki/pinSharedNoteTypes', () => ({ pinSharedNoteTypes }));

vi.mock('../data_layer', () => ({
  getDatabase: vi.fn().mockReturnValue({}),
}));

vi.mock('../data_layer/ShareRepository', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return { findByToken, recordView: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('../data_layer/DownloadRepository', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return { getFilename: vi.fn().mockResolvedValue('Shared deck.apkg') };
  }),
}));

import ShareRouter from './ShareRouter';

const bodyRead = vi.fn();

function storageReports(size: number) {
  const bytes = buildTinyApkg();
  send.mockImplementation(async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      return { ContentLength: size };
    }
    if (command instanceof GetObjectCommand) {
      return {
        Body: {
          transformToByteArray: async () => {
            bodyRead();
            return new Uint8Array(bytes);
          },
        },
      };
    }
    throw new Error('unexpected storage command');
  });
}

async function withServer<T>(run: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(ShareRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('ShareRouter shared deck preview, signed out', () => {
  let token = 0;
  const nextToken = () => `share-token-${(token += 1)}`;

  beforeEach(() => {
    process.env.SPACES_DEFAULT_BUCKET_NAME = 'test-bucket';
    process.env.SPACES_ENDPOINT = 'https://test.spaces.example.com';
    send.mockReset();
    bodyRead.mockReset();
    pinSharedNoteTypes.mockReset().mockImplementation(async (apkg) => apkg);
    findByToken.mockReset().mockResolvedValue({
      id: 1,
      owner: 42,
      upload_key: 'stored/42/deck.apkg',
      revoked_at: null,
    });
  });

  it('previews a shared deck under the size limit', async () => {
    storageReports(4096);
    const shared = nextToken();

    const res = await withServer((base) =>
      fetch(`${base}/api/shares/${shared}/meta`)
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ totalCards: 1 });
    expect(bodyRead).toHaveBeenCalledTimes(1);
  });

  it('refuses an oversized shared deck with 413 and never reads its body', async () => {
    storageReports(MAX_TOTAL_DECOMPRESSED_BYTES + 1);
    const shared = nextToken();

    const [meta, cards] = await withServer(async (base) => [
      await fetch(`${base}/api/shares/${shared}/meta`),
      await fetch(`${base}/api/shares/${shared}/cards`),
    ]);

    expect(meta.status).toBe(413);
    expect(await meta.json()).toEqual({
      message: 'This Anki package is too large to process.',
    });
    expect(cards.status).toBe(413);
    expect(bodyRead).not.toHaveBeenCalled();
  });

  it('refuses media from an oversized shared deck with 413 and never reads its body', async () => {
    storageReports(MAX_TOTAL_DECOMPRESSED_BYTES + 1);
    const shared = nextToken();

    const res = await withServer((base) =>
      fetch(`${base}/api/shares/${shared}/media/picture.png`)
    );

    expect(res.status).toBe(413);
    expect(bodyRead).not.toHaveBeenCalled();
  });

  it.each(['meta', 'cards', 'media/picture.png'])(
    'serves 404 for a shared deck deleted after it was cached (%s)',
    async (route) => {
      storageReports(4096);
      const shared = nextToken();

      const statuses = await withServer(async (base) => {
        const first = await fetch(`${base}/api/shares/${shared}/${route}`);
        send.mockRejectedValue(
          Object.assign(new Error('UnknownError'), {
            name: 'NotFound',
            $metadata: { httpStatusCode: 404 },
          })
        );
        const afterDelete = await fetch(
          `${base}/api/shares/${shared}/${route}`
        );
        return [first.status, afterDelete.status];
      });

      expect(statuses).toEqual([200, 404]);
      expect(bodyRead).toHaveBeenCalledTimes(1);
    }
  );

  it('checks the stored deck once per request and reads it only on the first', async () => {
    storageReports(4096);
    const shared = nextToken();

    await withServer(async (base) => {
      await fetch(`${base}/api/shares/${shared}/meta`);
      await fetch(`${base}/api/shares/${shared}/cards`);
    });

    const heads = send.mock.calls.filter(
      ([command]) => command instanceof HeadObjectCommand
    ).length;
    expect(heads).toBe(2);
    expect(bodyRead).toHaveBeenCalledTimes(1);
  });

  it('reads a shared deck once for concurrent viewers', async () => {
    storageReports(4096);
    const shared = nextToken();

    const statuses = await withServer((base) =>
      Promise.all(
        Array.from({ length: 6 }, async () => {
          const res = await fetch(`${base}/api/shares/${shared}/cards`);
          return res.status;
        })
      )
    );

    expect(statuses).toEqual(Array(6).fill(200));
    expect(bodyRead).toHaveBeenCalledTimes(1);
  });

  it('sends an oversized shared deck by redirect to storage without reading it', async () => {
    storageReports(MAX_TOTAL_DECOMPRESSED_BYTES + 1);
    const shared = nextToken();

    const res = await withServer((base) =>
      fetch(`${base}/api/shares/${shared}/download`, { redirect: 'manual' })
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://storage.example.com/signed-deck'
    );
    expect(bodyRead).not.toHaveBeenCalled();
    expect(pinSharedNoteTypes).not.toHaveBeenCalled();
  });

  it('still sends a shared deck under the limit as the pinned copy', async () => {
    storageReports(4096);
    const shared = nextToken();

    const res = await withServer((base) =>
      fetch(`${base}/api/shares/${shared}/download`)
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(pinSharedNoteTypes).toHaveBeenCalledTimes(1);
  });
});
