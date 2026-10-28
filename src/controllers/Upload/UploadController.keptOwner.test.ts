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
      const apkgPath = path.join(this.currentDirectory, 'kept-owner.apkg');
      fs.writeFileSync(apkgPath, 'kept-owner-apkg');
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

const OWNER = 4242;
const OTHER_OWNER = 9999;

const NOTES = `<html><head><title>Kept notes</title></head><body><article class="page sans"><header><h1 class="page-title">Kept notes</h1></header><div class="page-body">${[
  1, 2, 3,
]
  .map(
    (n) =>
      `<ul class="toggle"><li><details open=""><summary>Question ${n}</summary><p>Answer ${n}</p></details></li></ul>`
  )
  .join('')}</div></article></body></html>`;

interface Session {
  locals: Record<string, unknown>;
  cookies: Record<string, string>;
  headers: Record<string, string>;
}

const signedIn: Session = {
  locals: { owner: OWNER, patreon: false, subscriber: false },
  cookies: { token: 'session', anon_id: 'kept-anon' },
  headers: {},
};

const payingSignedIn: Session = {
  ...signedIn,
  locals: { owner: OWNER, patreon: false, subscriber: true },
};

const signedOut: Session = {
  locals: {},
  cookies: { anon_id: 'kept-anon' },
  headers: {},
};

const signedOutPassHolder: Session = {
  locals: { subscriber: true, passKind: '24h', anonymousPassId: 7 },
  cookies: { anon_id: 'kept-anon' },
  headers: { 'x-pass-token': 'kept-pass-token' },
};

let session: Session = signedOut;
let server: http.Server;
let baseUrl: string;
let uploadBase: string;
const jobsCreated: string[] = [];
const cardsCharged: number[] = [];
const originalEnv = {
  UPLOAD_BASE: process.env.UPLOAD_BASE,
  SPACES_ENDPOINT: process.env.SPACES_ENDPOINT,
  SPACES_DEFAULT_BUCKET_NAME: process.env.SPACES_DEFAULT_BUCKET_NAME,
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
        month_started_at: new Date('2026-10-01T00:00:00Z'),
      }),
    incrementCardUsage: (_owner: number, count: number) => {
      cardsCharged.push(count);
      return Promise.resolve(1);
    },
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

// Records the job a paying Claude upload asks for, then stops there: the test
// only needs to know whether the request got that far.
function recordingJobs(): JobRepository {
  return {
    create: (id: string) => {
      jobsCreated.push(id);
      return Promise.reject(new Error('job store is not part of this test'));
    },
  } as unknown as JobRepository;
}

beforeAll(async () => {
  uploadBase = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-kept-owner-'));
  process.env.UPLOAD_BASE = uploadBase;
  process.env.SPACES_ENDPOINT = 'https://kept-owner-storage.invalid';
  process.env.SPACES_DEFAULT_BUCKET_NAME = 'kept-owner-bucket';
  const app = express();
  app.use(cookieParser());
  app.post(
    '/api/upload/file',
    (_req, res, next) => {
      res.locals.requestId = 'kept-owner-request';
      Object.assign(res.locals, session.locals);
      next();
    },
    (req, res) => {
      const service = new UploadService(
        inMemoryUploads(),
        recordingJobs(),
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
  jobsCreated.length = 0;
  cardsCharged.length = 0;
  for (const entry of fs.readdirSync(uploadBase)) {
    fs.rmSync(path.join(uploadBase, entry), { recursive: true, force: true });
  }
});

async function resend(
  who: Session,
  fields: Record<string, string> = {}
): Promise<{ status: number; body: unknown }> {
  session = who;
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  form.append(
    'pakker',
    new Blob([NOTES], { type: 'text/html' }),
    'Kept notes.html'
  );
  const cookie = Object.entries(who.cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  const response = await fetch(`${baseUrl}/api/upload/file`, {
    method: 'POST',
    body: form,
    redirect: 'manual',
    headers: { ...who.headers, ...(cookie === '' ? {} : { cookie }) },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { status: response.status, body };
}

const tempFilesLeft = () => fs.readdirSync(uploadBase);

describe('a resend of kept files on /api/upload/file', () => {
  it.each([
    ['the signed-in account that sent it', signedIn, String(OWNER)],
    ['a visitor who sent it signed out and still is', signedOut, 'none'],
    [
      'an anonymous Day Pass holder resuming a file sent signed out',
      signedOutPassHolder,
      'none',
    ],
  ])('converts for %s', async (_label, who, keptOwner) => {
    const result = await resend(who, { 'kept-owner': keptOwner });

    expect(result).toEqual({ status: 200, body: 'kept-owner-apkg' });
  });

  it('converts an upload with no kept owner, as older pages send', async () => {
    const result = await resend(signedIn);

    expect(result).toEqual({ status: 200, body: 'kept-owner-apkg' });
    expect(s3Puts).toHaveLength(1);
    expect(cardsCharged).toEqual([3]);
  });

  it.each([
    ['another account', signedIn, String(OTHER_OWNER)],
    ['a signed-out visitor, now signed in', signedIn, 'none'],
    ['an account that has since signed out', signedOut, String(OWNER)],
    [
      'an account, now an anonymous Day Pass holder',
      signedOutPassHolder,
      String(OWNER),
    ],
  ])(
    'refuses a file sent by %s and converts nothing',
    async (_label, who, keptOwner) => {
      const result = await resend(who, { 'kept-owner': keptOwner });

      expect(result).toEqual({
        status: 409,
        body: expect.objectContaining({ code: 'owner_changed' }),
      });
      expect(s3Puts).toEqual([]);
      expect(cardsCharged).toEqual([]);
      expect(tempFilesLeft()).toEqual([]);
    }
  );

  it('makes the background Claude job for the paying account that sent the file', async () => {
    await resend(payingSignedIn, {
      'kept-owner': String(OWNER),
      'claude-ai-flashcards': 'true',
    });

    expect(jobsCreated).toHaveLength(1);
  });

  it('makes no Claude job, so spends no credits, for a file another account sent', async () => {
    const result = await resend(payingSignedIn, {
      'kept-owner': String(OTHER_OWNER),
      'claude-ai-flashcards': 'true',
    });

    expect(result.status).toBe(409);
    expect(jobsCreated).toEqual([]);
  });
});
