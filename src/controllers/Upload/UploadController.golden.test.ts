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
      const deckInfo = JSON.parse(
        fs.readFileSync(
          path.join(this.currentDirectory, 'deck_info.json'),
          'utf8'
        )
      ) as { cards: unknown[] }[];
      const cards = deckInfo.reduce((sum, deck) => sum + deck.cards.length, 0);
      const apkgPath = path.join(this.currentDirectory, 'golden.apkg');
      fs.writeFileSync(apkgPath, `golden-apkg cards=${cards}`);
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
import type { IFeatureFlagsRepository } from '../../data_layer/FeatureFlagsRepository';
import {
  __resetFeatureFlagModuleForTests,
  __setFeatureFlagDependencies,
} from '../../lib/featureFlags/getFeatureFlag';
import { ANONYMOUS_PARTIAL_DELIVERY_FLAG } from '../../lib/upload/anonymousPartialDelivery';
import { ANONYMOUS_DAY_PASS_CARD_FLAG } from '../../lib/upload/anonymousDayPassCard';
import { LIMIT_WALL_PASS_FIRST_FLAG } from '../../lib/featureFlags/limitWallPassFirst';
import { fakeUploadServiceDeps } from '../../test/fakes/uploadServiceDeps';

const SMALL_DECK_CARDS = 5;
const LARGE_DECK_CARDS = 120;
const OWNER = 4242;

function notionToggleExport(title: string, cardCount: number): string {
  const toggles = Array.from(
    { length: cardCount },
    (_, i) =>
      `<ul class="toggle"><li><details open=""><summary>Question ${i + 1}</summary><p>Answer ${i + 1}</p></details></li></ul>`
  ).join('');
  return `<html><head><title>${title}</title></head><body><article class="page sans"><header><h1 class="page-title">${title}</h1></header><div class="page-body">${toggles}</div></article></body></html>`;
}

const UPLOADS = {
  small: {
    filename: 'Golden Small.html',
    html: notionToggleExport('Golden Small', SMALL_DECK_CARDS),
  },
  large: {
    filename: 'Golden Large.html',
    html: notionToggleExport('Golden Large', LARGE_DECK_CARDS),
  },
};

interface Population {
  locals: Record<string, unknown>;
  cookies: Record<string, string>;
  headers: Record<string, string>;
  cardsUsed: number;
  flags: Record<string, boolean>;
}

const signedOut: Population = {
  locals: {},
  cookies: { anon_id: 'golden-anon' },
  headers: {},
  cardsUsed: 0,
  flags: {},
};

const signedInFree: Population = {
  locals: { owner: OWNER, patreon: false, subscriber: false },
  cookies: { token: 'session', anon_id: 'golden-anon' },
  headers: {},
  cardsUsed: 0,
  flags: {},
};

const cases: [string, keyof typeof UPLOADS, Population][] = [
  ['signed-out under the anonymous cap', 'small', signedOut],
  [
    'signed-out over the cap, partial delivery off',
    'large',
    { ...signedOut, flags: { [ANONYMOUS_PARTIAL_DELIVERY_FLAG]: false } },
  ],
  [
    'signed-out over the cap, partial delivery off, day pass card on',
    'large',
    { ...signedOut, flags: { [ANONYMOUS_DAY_PASS_CARD_FLAG]: true } },
  ],
  [
    'signed-out over the cap, partial delivery on (treatment)',
    'large',
    { ...signedOut, flags: { [ANONYMOUS_PARTIAL_DELIVERY_FLAG]: true } },
  ],
  [
    'signed-out over the cap, partial delivery on, day pass card on',
    'large',
    {
      ...signedOut,
      flags: {
        [ANONYMOUS_PARTIAL_DELIVERY_FLAG]: true,
        [ANONYMOUS_DAY_PASS_CARD_FLAG]: true,
      },
    },
  ],
  [
    'signed-out over the cap, partial delivery on, no anon id (control)',
    'large',
    {
      ...signedOut,
      cookies: {},
      flags: { [ANONYMOUS_PARTIAL_DELIVERY_FLAG]: true },
    },
  ],
  [
    'signed-out with an expired session cookie, over the cap',
    'large',
    {
      ...signedOut,
      cookies: { token: 'expired-session', anon_id: 'golden-anon' },
      flags: { [ANONYMOUS_PARTIAL_DELIVERY_FLAG]: true },
    },
  ],
  [
    'signed-out with an expired session cookie, over the cap, no anon id (control)',
    'large',
    {
      ...signedOut,
      cookies: { token: 'expired-session' },
      flags: { [ANONYMOUS_PARTIAL_DELIVERY_FLAG]: true },
    },
  ],
  [
    'signed-out with an expired session cookie, over the cap, day pass card on',
    'large',
    {
      ...signedOut,
      cookies: { token: 'expired-session', anon_id: 'golden-anon' },
      flags: { [ANONYMOUS_DAY_PASS_CARD_FLAG]: true },
    },
  ],
  [
    'signed-out with an expired session cookie, over the cap, partial delivery on, day pass card on',
    'large',
    {
      ...signedOut,
      cookies: { token: 'expired-session', anon_id: 'golden-anon' },
      flags: {
        [ANONYMOUS_PARTIAL_DELIVERY_FLAG]: true,
        [ANONYMOUS_DAY_PASS_CARD_FLAG]: true,
      },
    },
  ],
  [
    'signed-out with an expired session cookie, over the cap, pass-first wall on',
    'large',
    {
      ...signedOut,
      cookies: { token: 'expired-session', anon_id: 'golden-anon' },
      flags: { [LIMIT_WALL_PASS_FIRST_FLAG]: true },
    },
  ],
  [
    'signed-out pass holder with an expired session cookie',
    'large',
    {
      ...signedOut,
      cookies: { token: 'expired-session', anon_id: 'golden-anon' },
      locals: { subscriber: true, passKind: '24h', anonymousPassId: 7 },
      headers: { 'x-pass-token': 'golden-pass-token' },
    },
  ],
  ['signed-in free under the monthly limit', 'small', signedInFree],
  [
    'signed-in free whose upload exceeds the monthly limit',
    'large',
    signedInFree,
  ],
  [
    'signed-in free with 10 cards left this month',
    'large',
    { ...signedInFree, cardsUsed: 90 },
  ],
  [
    'signed-in free with the monthly limit used up',
    'small',
    { ...signedInFree, cardsUsed: 100 },
  ],
  [
    'paying subscriber',
    'large',
    {
      ...signedInFree,
      locals: { owner: OWNER, patreon: false, subscriber: true },
      cardsUsed: 100,
    },
  ],
  [
    'lifetime (patreon) user',
    'large',
    {
      ...signedInFree,
      locals: { owner: OWNER, patreon: true, subscriber: false },
      cardsUsed: 100,
    },
  ],
  [
    'signed-in pass holder',
    'large',
    {
      ...signedInFree,
      locals: {
        owner: OWNER,
        patreon: false,
        subscriber: true,
        passKind: '24h',
      },
      cardsUsed: 100,
    },
  ],
  [
    'signed-out pass holder',
    'large',
    {
      ...signedOut,
      locals: { subscriber: true, passKind: '24h', anonymousPassId: 7 },
      headers: { 'x-pass-token': 'golden-pass-token' },
    },
  ],
];

function inMemoryFlags(
  values: Record<string, boolean>
): IFeatureFlagsRepository {
  return {
    getAll: () => Promise.resolve([]),
    get: (key: string) => Promise.resolve(values[key] ?? null),
    set: () => Promise.resolve(null),
  };
}

const cardUsageCharges: number[] = [];

function inMemoryUsers(initialCardsUsed: number): UsersRepository {
  let cardsUsed = initialCardsUsed;
  return {
    getCardUsage: () =>
      Promise.resolve({
        cards_used: cardsUsed,
        month_started_at: new Date('2026-10-01T00:00:00Z'),
      }),
    incrementCardUsage: (_owner: number, count: number) => {
      cardsUsed += count;
      cardUsageCharges.push(count);
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

const CLIENT_HEADERS = [
  'location',
  'file-name',
  'content-disposition',
  'access-control-expose-headers',
];

function clientHeaders(response: Response): Record<string, string> {
  const picked: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    const userFacing =
      (name.startsWith('x-') && name !== 'x-powered-by') ||
      CLIENT_HEADERS.includes(name);
    if (userFacing) {
      picked[name] = name === 'x-download-key' ? '<download-key>' : value;
    }
  });
  return Object.fromEntries(
    Object.entries(picked).sort(([a], [b]) => a.localeCompare(b))
  );
}

async function clientBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  if (response.headers.get('content-disposition')?.startsWith('attachment')) {
    return { apkg: await response.text() };
  }
  return { text: await response.text() };
}

let population: Population = signedOut;
let server: http.Server;
let baseUrl: string;
let uploadBase: string;
const GOLDEN_ENV: Record<string, string | undefined> = {
  SKIP_CREATE_DECK: undefined,
  SPACES_ENDPOINT: 'https://golden-storage.invalid',
  SPACES_DEFAULT_BUCKET_NAME: 'golden-bucket',
};
const originalEnv = Object.fromEntries(
  [...Object.keys(GOLDEN_ENV), 'UPLOAD_BASE'].map((key) => [
    key,
    process.env[key],
  ])
);

function applyEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function storedObjectKind(key: string): string {
  return key.startsWith('held/') ? 'held source file' : 'deck';
}

beforeAll(async () => {
  uploadBase = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-golden-'));
  applyEnv({ ...GOLDEN_ENV, UPLOAD_BASE: uploadBase });
  const app = express();
  app.use(cookieParser());
  app.post(
    '/api/upload/file',
    (_req, res, next) => {
      res.locals.requestId = 'golden-request';
      Object.assign(res.locals, population.locals);
      next();
    },
    (req, res) => {
      const service = new UploadService(
        inMemoryUploads(),
        {} as unknown as JobRepository,
        inMemoryUsers(population.cardsUsed),
        ...fakeUploadServiceDeps()
      );
      const controller = new UploadController(
        service,
        {} as unknown as NotionService
      );
      controller.file(req, res);
    }
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(uploadBase, { recursive: true, force: true });
  applyEnv(originalEnv);
});

afterEach(() => {
  __resetFeatureFlagModuleForTests();
  s3Puts.length = 0;
  cardUsageCharges.length = 0;
});

async function upload(file: keyof typeof UPLOADS, who: Population) {
  population = who;
  __setFeatureFlagDependencies({ repository: inMemoryFlags(who.flags) });
  const form = new FormData();
  form.append(
    'pakker',
    new Blob([UPLOADS[file].html], { type: 'text/html' }),
    UPLOADS[file].filename
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
  return {
    status: response.status,
    contentType: (response.headers.get('content-type') ?? '').split(';')[0],
    headers: clientHeaders(response),
    body: await clientBody(response),
    storedObjects: s3Puts.map(storedObjectKind),
    cardsCharged: [...cardUsageCharges],
  };
}

describe('what each population gets back from /api/upload/file', () => {
  it.each(cases)(
    '%s',
    async (_label, file, who) => {
      expect(await upload(file, who)).toMatchSnapshot();
    },
    20_000
  );
});
