import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

import { buildTinyApkg } from '../test/fixtures/apkg/buildTinyApkg';

const send = vi.hoisted(() => vi.fn());
const addNote = vi.hoisted(() => vi.fn());

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

vi.mock('./middleware/RequireAnkifyAccess', () => ({
  __esModule: true,
  default: (
    _req: unknown,
    res: { locals: Record<string, unknown> },
    next: () => void
  ) => {
    res.locals.owner = 7;
    next();
  },
}));

vi.mock('../data_layer/UploadRespository', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return {
      findByIdAndOwner: vi.fn().mockResolvedValue({
        id: 5,
        owner: 7,
        key: 'uploads/7/deck.apkg',
        filename: 'deck.apkg',
      }),
    };
  }),
}));

vi.mock('../data_layer/ankify/AnkifyClientsRepository', () => ({
  AnkifyClientsRepository: vi.fn().mockImplementation(function () {
    return {
      findActiveByOwner: vi.fn().mockResolvedValue({
        id: 1,
        owner: 7,
        anki_port: 8765,
        anki_connect_api_key: null,
      }),
      touchLastActiveAt: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('../data_layer/ankify/AnkifySyncMappingsRepository', () => ({
  AnkifySyncMappingsRepository: vi.fn().mockImplementation(function () {
    return {
      findBySourceId: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    };
  }),
}));

vi.mock('../data_layer/ankify/AnkifySyncLogsRepository', () => ({
  AnkifySyncLogsRepository: vi.fn().mockImplementation(function () {
    return { log: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('../data_layer/SettingsRepository', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return { loadAnkifyTemplateOverrides: vi.fn().mockResolvedValue(null) };
  }),
}));

vi.mock('../services/ankify/buildAnkiConnectClient', () => ({
  ankiConnectFactory: () => ({
    modelNames: vi.fn().mockResolvedValue([]),
    createModel: vi.fn().mockResolvedValue(undefined),
    storeMediaFile: vi.fn().mockResolvedValue('picture.png'),
    createDeck: vi.fn().mockResolvedValue(1),
    addNote,
    updateNoteFields: vi.fn().mockResolvedValue(null),
    sync: vi.fn().mockResolvedValue(null),
  }),
}));

import AnkifyRouter from './AnkifyRouter';
import { AnkiConnectTimeoutError } from '../services/ankify/AnkiConnectClient';
import { SendDeadlineExceededError } from '../usecases/ankify/SendUploadToRacUseCase';
import {
  COLD_LOAD_BUDGET_BYTES,
  PREVIEW_MAX_STORED_BYTES,
  resetPreviewMemoryLimitsForTesting,
  sharedPreviewLimits,
} from '../services/ApkgPreviewService/previewMemoryLimits';

const MIB = 1024 * 1024;

function storageReports(size: number | undefined) {
  const bytes = buildTinyApkg();
  send.mockImplementation(async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      return { ContentLength: size };
    }
    if (command instanceof GetObjectCommand) {
      return {
        Body: { transformToByteArray: async () => new Uint8Array(bytes) },
      };
    }
    throw new Error('unexpected storage command');
  });
}

function bodyRequests(): number {
  return send.mock.calls.filter(
    ([command]) => command instanceof GetObjectCommand
  ).length;
}

async function withServer<T>(run: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use(AnkifyRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function postDispatch(base: string): Promise<Response> {
  return fetch(`${base}/api/ankify/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ upload_id: 5 }),
  });
}

function dispatch(): Promise<Response> {
  return withServer(postDispatch);
}

function heldNote(): { release: () => void } {
  let release: () => void = () => {};
  const pending = new Promise<number>((resolve) => {
    release = () => resolve(101);
  });
  addNote.mockImplementationOnce(() => pending);
  return { release };
}

describe('AnkifyRouter sending an upload to Ankify', () => {
  beforeEach(() => {
    process.env.SPACES_DEFAULT_BUCKET_NAME = 'test-bucket';
    process.env.SPACES_ENDPOINT = 'https://test.spaces.example.com';
    resetPreviewMemoryLimitsForTesting();
    send.mockReset();
    addNote.mockReset().mockResolvedValue(101);
  });

  it('sends a 200 MiB upload', async () => {
    storageReports(200 * MIB);

    const res = await dispatch();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 1 });
    expect(bodyRequests()).toBe(1);
  });

  it('sends an upload at the size limit after checking its size', async () => {
    storageReports(PREVIEW_MAX_STORED_BYTES);

    const res = await dispatch();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 1 });
    expect(bodyRequests()).toBe(1);
  });

  it.each([PREVIEW_MAX_STORED_BYTES + 1, 300 * MIB])(
    'refuses an upload of %s bytes with 413 and never requests its body',
    async (size) => {
      storageReports(size);

      const res = await dispatch();

      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({
        message: 'This Anki package is too large to process.',
      });
      expect(bodyRequests()).toBe(0);
      expect(addNote).not.toHaveBeenCalled();
    }
  );

  it('refuses an upload whose size storage does not report and never requests its body', async () => {
    storageReports(undefined);

    const res = await dispatch();

    expect(res.status).toBe(413);
    expect(bodyRequests()).toBe(0);
  });

  it('waits for room under the shared cold-load limit before reading the upload', async () => {
    storageReports(4096);
    const release = await sharedPreviewLimits().coldLoads.acquire(
      COLD_LOAD_BUDGET_BYTES
    );

    const status = await withServer(async (base) => {
      const pending = postDispatch(base);
      await vi.waitFor(() =>
        expect(sharedPreviewLimits().coldLoads.waiting).toBe(1)
      );
      expect(bodyRequests()).toBe(0);
      release();
      return (await pending).status;
    });

    expect(status).toBe(200);
    expect(bodyRequests()).toBe(1);
  });

  it('gives back its place under the limit before pushing notes to Anki', async () => {
    storageReports(4096);
    const note = heldNote();

    const status = await withServer(async (base) => {
      const pending = postDispatch(base);
      await vi.waitFor(() => expect(addNote).toHaveBeenCalledTimes(1));
      expect(sharedPreviewLimits().coldLoads.inUse).toBe(0);
      note.release();
      return (await pending).status;
    });

    expect(status).toBe(200);
  });

  it('refuses a second send from the same account while the first is still running', async () => {
    storageReports(4096);
    const note = heldNote();

    const [second, first, later] = await withServer(async (base) => {
      const running = postDispatch(base);
      await vi.waitFor(() => expect(addNote).toHaveBeenCalledTimes(1));
      const overlapping = await postDispatch(base);
      note.release();
      const finished = await running;
      const afterwards = await postDispatch(base);
      return [overlapping, finished, afterwards];
    });

    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      message:
        'A deck is already on its way to Anki. Try again once it is done.',
    });
    expect(first.status).toBe(200);
    expect(later.status).toBe(200);
  });

  it('takes a new send once a failed one has ended', async () => {
    storageReports(4096);
    addNote.mockRejectedValueOnce(new Error('connection dropped'));

    const statuses = await withServer(async (base) => [
      (await postDispatch(base)).status,
      (await postDispatch(base)).status,
    ]);

    expect(statuses).toEqual([200, 200]);
    expect(sharedPreviewLimits().coldLoads.inUse).toBe(0);
  });

  it.each([
    [
      'a call timed out',
      new AnkiConnectTimeoutError('http://anki', 'addNote', 10_000, null),
    ],
    ['the send passed its deadline', new SendDeadlineExceededError(1)],
  ])(
    'answers 503 with the unreachable message when %s, then takes the next send',
    async (_case, error) => {
      storageReports(4096);
      addNote.mockRejectedValueOnce(error);

      const [stopped, next] = await withServer(async (base) => [
        await postDispatch(base),
        await postDispatch(base),
      ]);

      expect(stopped.status).toBe(503);
      expect(await stopped.json()).toEqual({
        message:
          'AnkiConnect is unreachable. Make sure the hosted Anki container is healthy.',
      });
      expect(next.status).toBe(200);
    }
  );
});
