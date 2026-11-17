import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

import { buildTinyApkg } from '../test/fixtures/apkg/buildTinyApkg';
import { MAX_TOTAL_DECOMPRESSED_BYTES } from '../services/ApkgPreviewService/extractApkg';

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

async function dispatch(): Promise<Response> {
  const app = express();
  app.use(express.json());
  app.use(AnkifyRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fetch(`http://127.0.0.1:${port}/api/ankify/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ upload_id: 5 }),
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('AnkifyRouter sending an upload to Ankify', () => {
  beforeEach(() => {
    process.env.SPACES_DEFAULT_BUCKET_NAME = 'test-bucket';
    process.env.SPACES_ENDPOINT = 'https://test.spaces.example.com';
    send.mockReset();
    addNote.mockReset().mockResolvedValue(101);
  });

  it('sends an upload at the size limit after checking its size', async () => {
    storageReports(MAX_TOTAL_DECOMPRESSED_BYTES);

    const res = await dispatch();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 1 });
    expect(bodyRequests()).toBe(1);
  });

  it('refuses an upload over the size limit with 413 and never requests its body', async () => {
    storageReports(MAX_TOTAL_DECOMPRESSED_BYTES + 1);

    const res = await dispatch();

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      message: 'This Anki package is too large to process.',
    });
    expect(bodyRequests()).toBe(0);
    expect(addNote).not.toHaveBeenCalled();
  });

  it('refuses an upload whose size storage does not report and never requests its body', async () => {
    storageReports(undefined);

    const res = await dispatch();

    expect(res.status).toBe(413);
    expect(bodyRequests()).toBe(0);
  });
});
