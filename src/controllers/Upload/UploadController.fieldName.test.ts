import { vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';

const s3Puts = vi.hoisted(() => [] as string[]);

vi.mock('@aws-sdk/client-s3', async (importActual) => {
  const actual = await importActual<typeof import('@aws-sdk/client-s3')>();
  class RecordingS3Client {
    async send(command: { input?: { Key?: string } }) {
      if (command instanceof actual.PutObjectCommand) {
        s3Puts.push(command.input?.Key ?? '');
      }
      return {};
    }
  }
  return { ...actual, S3Client: RecordingS3Client };
});

vi.mock('../../lib/anki/CardGenerator', () => ({
  __esModule: true,
  default: class FakePythonCardGenerator {
    constructor(private readonly currentDirectory: string) {}
    async run(): Promise<string> {
      const apkgPath = path.join(this.currentDirectory, 'field-name.apkg');
      fs.writeFileSync(apkgPath, 'field-name-apkg');
      return apkgPath;
    }
  },
}));

vi.mock('../../lib/conversionPool', async (importActual) => {
  const actual =
    await importActual<typeof import('../../lib/conversionPool')>();
  const worker = await import('../../usecases/uploads/worker');
  return {
    ...actual,
    runUploadGeneration: worker.runUploadGenerationInWorker,
  };
});

vi.mock('../../services/events/eventsSinkInstance', () => ({
  getEventsSink: () => ({
    record: () => undefined,
    flushDurable: () => Promise.resolve(),
  }),
  resetEventsSinkForTesting: () => undefined,
}));

import UploadController from './UploadController';
import UploadService from '../../services/UploadService';
import type NotionService from '../../services/NotionService';
import type JobRepository from '../../data_layer/JobRepository';
import type UsersRepository from '../../data_layer/UsersRepository';
import type { IUploadRepository } from '../../data_layer/UploadRespository';
import type Uploads from '../../data_layer/public/Uploads';
import {
  __resetFeatureFlagModuleForTests,
  __setFeatureFlagDependencies,
} from '../../lib/featureFlags/getFeatureFlag';
import { fakeUploadServiceDeps } from '../../test/fakes/uploadServiceDeps';
import { FREE_USER_MAX_UPLOAD_SIZE } from '../../lib/misc/getUploadLimits';

const NOTES = `<html><head><title>Field notes</title></head><body><article class="page sans"><header><h1 class="page-title">Field notes</h1></header><div class="page-body">${[
  1, 2, 3,
]
  .map(
    (n) =>
      `<ul class="toggle"><li><details open=""><summary>Question ${n}</summary><p>Answer ${n}</p></details></li></ul>`
  )
  .join('')}</div></article></body></html>`;

let server: http.Server;
let baseUrl: string;
let uploadBase: string;
let workspaceBase: string;
const originalEnv = {
  UPLOAD_BASE: process.env.UPLOAD_BASE,
  SPACES_ENDPOINT: process.env.SPACES_ENDPOINT,
  SPACES_DEFAULT_BUCKET_NAME: process.env.SPACES_DEFAULT_BUCKET_NAME,
  SKIP_CREATE_DECK: process.env.SKIP_CREATE_DECK,
  WORKSPACE_BASE: process.env.WORKSPACE_BASE,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function inMemoryUsers(): UsersRepository {
  return {
    getCardUsage: () =>
      Promise.resolve({
        cards_used: 0,
        month_started_at: new Date('2026-11-01T00:00:00Z'),
      }),
    incrementCardUsage: () => Promise.resolve(1),
    getCardOptions: () => Promise.resolve(null),
  } as unknown as UsersRepository;
}

function inMemoryUploads(): IUploadRepository {
  const unsupported = () => Promise.reject(new Error('not used by upload'));
  return {
    deleteUpload: () => Promise.resolve(1),
    getUploadsByOwner: () => Promise.resolve([] as Uploads[]),
    findByIdAndOwner: () => Promise.resolve(null),
    findByObjectId: () => Promise.resolve(null),
    findByKey: () => Promise.resolve(null),
    findAllByObjectIdAndOwner: () => Promise.resolve([] as Uploads[]),
    update: () => Promise.resolve([] as Uploads[]),
    getLastUploadForUser: () => Promise.resolve(null),
    getLastReconvertibleUpload: () => Promise.resolve(null),
    findByOwnerAndDedupeKey: () => Promise.resolve(null),
    insertNativeDeck: unsupported,
    insertConvertedDeck: unsupported,
  };
}

function inMemoryJobs(): JobRepository {
  return {
    create: () => Promise.resolve(),
    updateJobStatus: () => Promise.resolve(),
    deleteJob: () => Promise.resolve(),
  } as unknown as JobRepository;
}

beforeAll(async () => {
  uploadBase = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-field-name-'));
  workspaceBase = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-field-'));
  process.env.UPLOAD_BASE = uploadBase;
  process.env.WORKSPACE_BASE = workspaceBase;
  process.env.SPACES_ENDPOINT = 'https://field-name-storage.invalid';
  process.env.SPACES_DEFAULT_BUCKET_NAME = 'field-name-bucket';
  delete process.env.SKIP_CREATE_DECK;
  const app = express();
  app.use(cookieParser());
  app.post(
    '/api/upload/file',
    (_req, res, next) => {
      res.locals.requestId = 'field-name-request';
      Object.assign(res.locals, { owner: 4242, patreon: false });
      next();
    },
    (req, res) => {
      const service = new UploadService(
        inMemoryUploads(),
        inMemoryJobs(),
        inMemoryUsers(),
        ...fakeUploadServiceDeps()
      );
      new UploadController(service, {} as unknown as NotionService).file(
        req,
        res
      );
    }
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(uploadBase, { recursive: true, force: true });
  fs.rmSync(workspaceBase, { recursive: true, force: true });
  restoreEnv();
});

beforeEach(() => {
  __setFeatureFlagDependencies({
    repository: {
      getAll: () => Promise.resolve([]),
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(null),
    },
  });
});

afterEach(() => {
  __resetFeatureFlagModuleForTests();
  s3Puts.length = 0;
  for (const entry of fs.readdirSync(uploadBase)) {
    fs.rmSync(path.join(uploadBase, entry), { recursive: true, force: true });
  }
});

async function postFiles(
  fieldNames: string[]
): Promise<{ status: number; body: unknown }> {
  const form = new FormData();
  fieldNames.forEach((fieldName, index) => {
    form.append(
      fieldName,
      new Blob([NOTES], { type: 'text/html' }),
      `Field notes ${index + 1}.html`
    );
  });
  const response = await fetch(`${baseUrl}/api/upload/file`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { status: response.status, body };
}

async function postFile(
  fieldName: string,
  bytes: Uint8Array<ArrayBuffer>
): Promise<{ status: number; body: unknown }> {
  const form = new FormData();
  form.append(
    fieldName,
    new Blob([bytes], { type: 'text/html' }),
    'Field notes.html'
  );
  const response = await fetch(`${baseUrl}/api/upload/file`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
  });
  return { status: response.status, body: await response.json() };
}

function postTruncatedBody(): Promise<{ status: number; body: unknown }> {
  const boundary = 'field-name-boundary';
  const partial = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="pakker"; filename="Field notes.html"',
    'Content-Type: text/html',
    '',
    NOTES.slice(0, 80),
  ].join('\r\n');
  return new Promise((resolve, reject) => {
    const request = http.request(
      `${baseUrl}/api/upload/file`,
      {
        method: 'POST',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(text) })
        );
      }
    );
    request.on('error', reject);
    request.end(partial);
  });
}

const tempFilesLeft = () => fs.readdirSync(uploadBase);

describe('the multipart field a file arrives under on /api/upload/file', () => {
  it.each(['pakker', 'file'])(
    'converts a file sent under %s',
    async (fieldName) => {
      const result = await postFiles([fieldName]);

      expect(result).toEqual({ status: 200, body: 'field-name-apkg' });
      expect(s3Puts).toHaveLength(1);
    }
  );

  it.each(['pakker', 'file'])(
    'converts a batch of files sent under %s',
    async (fieldName) => {
      const result = await postFiles([fieldName, fieldName]);

      expect(result).toMatchObject({
        status: 200,
        body: { kind: 'batch', deckCount: 2 },
      });
    }
  );

  it.each(['pakker', 'file'])(
    'refuses more files under %s than the plan takes',
    async (fieldName) => {
      const result = await postFiles(Array(22).fill(fieldName));

      expect(result).toMatchObject({
        status: 400,
        body: { code: 'too_many_files' },
      });
    }
  );

  it.each(['pakker', 'file'])(
    'refuses a file over the plan size under %s and stores nothing',
    async (fieldName) => {
      const result = await postFile(
        fieldName,
        new Uint8Array(FREE_USER_MAX_UPLOAD_SIZE + 1)
      );

      expect(result).toMatchObject({
        status: 413,
        body: { code: 'too_large' },
      });
      expect(s3Puts).toEqual([]);
      expect(tempFilesLeft()).toEqual([]);
    },
    60_000
  );

  it('removes a stored file when a later one arrives under another field', async () => {
    const result = await postFiles(['pakker', 'document']);

    expect(result).toMatchObject({
      status: 400,
      body: { code: 'wrong_upload_field' },
    });
    expect(s3Puts).toEqual([]);
    expect(tempFilesLeft()).toEqual([]);
  });

  it('names the field to use when the file arrives under another one', async () => {
    const result = await postFiles(['document']);

    expect(result).toEqual({
      status: 400,
      body: {
        code: 'wrong_upload_field',
        message:
          'Upload failed — send the file in a form field named “pakker” or “file”.',
      },
    });
    expect(s3Puts).toEqual([]);
    expect(tempFilesLeft()).toEqual([]);
  });

  it('refuses files split across both accepted fields and stores nothing', async () => {
    const result = await postFiles(['pakker', 'file']);

    expect(result).toEqual({
      status: 400,
      body: {
        code: 'wrong_upload_field',
        message:
          'Upload failed — send every file in one form field, “pakker” or “file”, not both.',
      },
    });
    expect(s3Puts).toEqual([]);
    expect(tempFilesLeft()).toEqual([]);
  });

  it('still answers upload_incomplete when the body breaks off', async () => {
    const result = await postTruncatedBody();

    expect(result).toEqual({
      status: 400,
      body: {
        code: 'upload_incomplete',
        message:
          'Your upload didn’t finish, so there was nothing to convert. Upload the file again.',
      },
    });
    expect(tempFilesLeft()).toEqual([]);
  });
});
