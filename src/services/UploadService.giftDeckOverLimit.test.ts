import { vi, type Mock } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type express from 'express';

const storedKeys = vi.hoisted(() => [] as string[]);

vi.mock('@aws-sdk/client-s3', async (importActual) => {
  const actual = await importActual<typeof import('@aws-sdk/client-s3')>();
  class RecordingS3Client {
    async send(command: { input?: { Key?: string } }) {
      if (command instanceof actual.PutObjectCommand) {
        storedKeys.push(command.input?.Key ?? '');
      }
      return {};
    }
  }
  return { ...actual, S3Client: RecordingS3Client };
});

vi.mock('../lib/conversionPool', async (importActual) => {
  const actual = await importActual<typeof import('../lib/conversionPool')>();
  const worker = await import('../usecases/uploads/worker');
  return {
    ...actual,
    runUploadGeneration: worker.runUploadGenerationInWorker,
  };
});

vi.mock('../lib/anki/CardGenerator', () => ({
  __esModule: true,
  default: class FakePythonCardGenerator {
    constructor(private readonly currentDirectory: string) {}
    async run(): Promise<string> {
      const apkgPath = path.join(this.currentDirectory, 'deck.apkg');
      fs.writeFileSync(apkgPath, 'apkg');
      return apkgPath;
    }
  },
}));

const CLAUDE_CARDS_PER_FILE = vi.hoisted(() => 20);

vi.mock('../lib/claude/ClaudeService', async (importActual) => {
  const actual =
    await importActual<typeof import('../lib/claude/ClaudeService')>();
  const guard = await import('../lib/claude/aiSpendGuard');
  return {
    ...actual,
    generateDeckInfo: vi.fn(async (html: string) => {
      if (html.includes('GIFT-RAN-OUT')) {
        throw new guard.AiCreditsExhaustedError();
      }
      const topic = /<title>(.*?)<\/title>/.exec(html)?.[1] ?? 'notes';
      return [
        {
          name: topic,
          image: '',
          style: null,
          id: topic.length * 1000 + 7,
          settings: { template: 'specialstyle' },
          cards: Array.from({ length: CLAUDE_CARDS_PER_FILE }, (_, i) => ({
            name: `${topic} question ${i}`,
            back: `${topic} answer ${i}`,
            tags: [],
            cloze: false,
            number: i,
            enableInput: false,
            answer: '',
            media: [],
          })),
        },
      ];
    }),
  };
});

vi.mock('../lib/claude/aiSpendGuard', async (importActual) => {
  const actual =
    await importActual<typeof import('../lib/claude/aiSpendGuard')>();
  return {
    ...actual,
    getAiBudgetStatus: vi
      .fn()
      .mockResolvedValue({ exhausted: false, balance: null }),
  };
});

vi.mock('./events/eventsSinkInstance', () => ({
  getEventsSink: () => ({
    record: () => undefined,
    flushDurable: () => Promise.resolve(),
  }),
  resetEventsSinkForTesting: () => undefined,
}));

import UploadService from './UploadService';
import type JobRepository from '../data_layer/JobRepository';
import type UsersRepository from '../data_layer/UsersRepository';
import type { IUploadRepository } from '../data_layer/UploadRespository';
import type Uploads from '../data_layer/public/Uploads';
import type { IFeatureFlagsRepository } from '../data_layer/FeatureFlagsRepository';
import {
  __resetFeatureFlagModuleForTests,
  __setFeatureFlagDependencies,
} from '../lib/featureFlags/getFeatureFlag';
import { fakeUploadServiceDeps } from '../test/fakes/uploadServiceDeps';
import { resetGiftMarkers } from '../lib/claude/aiCredits/gift/giftConversionMarker';
import type { AiGiftGrant } from '../lib/claude/aiCredits/gift/giftBalance';
import type { UploadGiftModeDeps } from '../lib/claude/aiCredits/gift/uploadGiftMode';
import { MONTHLY_CARD_LIMIT } from '../usecases/users/CheckMonthlyCardLimitUseCase';

const OWNER = 42;
const NOW = new Date('2026-11-26T12:00:00.000Z');

const activeGrant: AiGiftGrant = {
  id: 3,
  userId: OWNER,
  credits: 100,
  claimedAt: new Date('2026-11-25T10:00:00.000Z'),
  expiresAt: new Date('2026-12-02T10:00:00.000Z'),
  firstUsedAt: new Date('2026-11-25T10:05:00.000Z'),
};

const expiredGrant: AiGiftGrant = {
  ...activeGrant,
  expiresAt: new Date('2026-11-26T10:00:00.000Z'),
};

const SPENT_GIFT_USD = 100;

function giftReaders(
  options: {
    enabled?: boolean;
    grant?: AiGiftGrant | null;
    spendUsd?: number;
  } = {}
): () => UploadGiftModeDeps {
  return () => ({
    isEnabled: async () => options.enabled ?? true,
    findGrant: async () =>
      options.grant === undefined ? activeGrant : options.grant,
    giftCostSince: async () => options.spendUsd ?? 0,
    now: () => NOW,
    planSpent: async () => true,
    startGrant: async () => null,
  });
}

function noFlagsSet(): IFeatureFlagsRepository {
  return {
    getAll: () => Promise.resolve([]),
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(null),
  };
}

function recordingUploads(): IUploadRepository {
  const unsupported = () => Promise.reject(new Error('not used by upload'));
  return {
    deleteUpload: () => Promise.resolve(1),
    getUploadsByOwner: () => Promise.resolve([] as Uploads[]),
    findByIdAndOwner: () => Promise.resolve(null),
    findByObjectId: () => Promise.resolve(null),
    findByKey: () => Promise.resolve(null),
    findAllByObjectIdAndOwner: () => Promise.resolve([] as Uploads[]),
    update: vi.fn().mockResolvedValue([] as Uploads[]),
    getLastUploadForUser: () => Promise.resolve(null),
    getLastReconvertibleUpload: () => Promise.resolve(null),
    findByOwnerAndDedupeKey: () => Promise.resolve(null),
    insertNativeDeck: unsupported,
    insertConvertedDeck: unsupported,
  };
}

function settlingJobs() {
  let settle!: (outcome: string) => void;
  const settled = new Promise<string>((resolve) => {
    settle = resolve;
  });
  const jobs = {
    create: vi.fn().mockResolvedValue(undefined),
    updateJobStatus: vi.fn(
      async (_id: string, _owner: string, status: string, reason?: string) => {
        if (status === 'failed') settle(`failed: ${reason ?? ''}`);
      }
    ),
    findJobById: vi.fn().mockResolvedValue({ id: 7, object_id: 'job-ws' }),
    restartJob: vi.fn().mockResolvedValue({ id: 7 }),
    deleteJob: vi.fn(async () => settle('delivered')),
  };
  return { jobs, settled };
}

function usersWith(cardsUsed: number) {
  return {
    getCardOptions: vi.fn().mockResolvedValue(null),
    latestAiToggleEventName: vi.fn().mockResolvedValue(null),
    getCardUsage: vi.fn().mockResolvedValue({
      cards_used: cardsUsed,
      month_started_at: new Date('2026-11-01T00:00:00Z'),
    }),
    incrementCardUsage: vi.fn().mockResolvedValue(1),
  };
}

function responseWith(locals: Record<string, unknown>) {
  let status = 0;
  let body: unknown = null;
  let redirectedTo: string | null = null;
  const res = {
    locals: { ...locals, requestId: 'gift-over-limit' },
    headersSent: false,
    status: vi.fn((code: number) => {
      status = code;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      body = payload;
      return res;
    }),
    redirect: vi.fn((to: string) => {
      redirectedTo = to;
      return res;
    }),
    set: vi.fn(() => res),
    send: vi.fn(() => res),
    contentType: vi.fn(() => res),
    attachment: vi.fn(() => res),
  };
  return {
    res: res as unknown as express.Response,
    status: () => status,
    body: () => body,
    redirectedTo: () => redirectedTo,
  };
}

function notionPage(topic: string, marker = ''): Buffer {
  const toggles = Array.from(
    { length: CLAUDE_CARDS_PER_FILE },
    (_, i) =>
      `<ul class="toggle"><li><details open=""><summary>${topic} front ${i}</summary><p>${topic} back ${i}</p></details></li></ul>`
  ).join('');
  return Buffer.from(
    `<html><head><title>${topic}</title></head><body><article class="page sans"><header><h1 class="page-title">${topic}</h1></header><div class="page-body">${marker}${toggles}</div></article></body></html>`
  );
}

function htmlFile(topic: string, marker = '') {
  const buffer = notionPage(topic, marker);
  return {
    originalname: `${topic}.html`,
    mimetype: 'text/html',
    buffer,
    size: buffer.length,
  };
}

const TWO_CLAUDE_FILES = [htmlFile('alpha'), htmlFile('beta')];
const TWO_CLAUDE_CARDS = 2 * CLAUDE_CARDS_PER_FILE;
const CARDS_USED_LEAVING_25 = MONTHLY_CARD_LIMIT - 25;

const FREE = { owner: OWNER };
const PAYING = { owner: OWNER, subscriber: true };
const PASS_HOLDER = {
  owner: OWNER,
  subscriber: true,
  passKind: 'week',
  passExpiresAt: '2026-12-03T00:00:00.000Z',
};
const MCP_FREE = { owner: OWNER, mcp_auth: true };

const claudeOn = { 'claude-ai-flashcards': 'true' };

const ENV: Record<string, string | undefined> = {
  SKIP_CREATE_DECK: undefined,
  SPACES_ENDPOINT: 'https://gift-storage.invalid',
  SPACES_DEFAULT_BUCKET_NAME: 'gift-bucket',
};
const originalEnv = Object.fromEntries(
  Object.keys(ENV).map((key) => [key, process.env[key]])
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

const cardLimitWall = expect.stringMatching(/^\/limit\?kind=card_count&/);

const originalWorkspaceBase = process.env.WORKSPACE_BASE;
let workspaceBase: string;

beforeAll(() => applyEnv(ENV));

afterAll(() => applyEnv(originalEnv));

beforeEach(() => {
  resetGiftMarkers();
  workspaceBase = fs.mkdtempSync(path.join(os.tmpdir(), 'gift-over-limit-'));
  process.env.WORKSPACE_BASE = workspaceBase;
  __setFeatureFlagDependencies({ repository: noFlagsSet() });
});

afterEach(() => {
  __resetFeatureFlagModuleForTests();
  storedKeys.length = 0;
  process.env.WORKSPACE_BASE = originalWorkspaceBase;
  fs.rmSync(workspaceBase, { recursive: true, force: true });
});

async function upload(options: {
  files: ReturnType<typeof htmlFile>[];
  cardsUsed: number;
  locals: Record<string, unknown>;
  readers?: () => UploadGiftModeDeps;
  body?: Record<string, string>;
}) {
  const users = usersWith(options.cardsUsed);
  const { jobs, settled } = settlingJobs();
  const service = new UploadService(
    recordingUploads(),
    jobs as unknown as JobRepository,
    users as unknown as UsersRepository,
    ...fakeUploadServiceDeps(),
    undefined,
    options.readers ?? giftReaders()
  );
  const req = {
    files: options.files,
    body: options.body ?? claudeOn,
    headers: {},
    cookies: {},
    path: '/api/upload/file',
  } as unknown as express.Request;
  const response = responseWith(options.locals);
  await service.handleUpload(req, response.res);
  return { ...response, jobs, settled, users };
}

describe('a Claude deck the free AI credits gift paid for, past the monthly card limit', () => {
  it.each([
    ['on the web', FREE, claudeOn],
    ['from an MCP client', MCP_FREE, claudeOn],
    ['from the app', FREE, { ...claudeOn, source: 'app' }],
  ])(
    'is delivered in full %s and its cards count toward the month',
    async (_entry, locals, body) => {
      const { status, settled, users } = await upload({
        files: TWO_CLAUDE_FILES,
        cardsUsed: CARDS_USED_LEAVING_25,
        locals,
        body,
      });

      expect(status()).toBe(202);
      expect(await settled).toBe('delivered');
      expect(storedKeys).toHaveLength(1);
      expect(users.incrementCardUsage).toHaveBeenCalledWith(
        OWNER,
        TWO_CLAUDE_CARDS
      );
    },
    20_000
  );

  it('logs the cards it delivered past the limit', async () => {
    const info = vi.spyOn(console, 'info');

    const { settled } = await upload({
      files: TWO_CLAUDE_FILES,
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });
    await settled;

    expect(info).toHaveBeenCalledWith(
      '[ai-gift] gift-paid deck delivered past the monthly card limit',
      { jobId: expect.any(String), cardsOverLimit: TWO_CLAUDE_CARDS - 25 }
    );
    info.mockRestore();
  }, 20_000);

  it('is delivered when the gift ran out after Claude made one file, the parser making the other', async () => {
    const { settled, users } = await upload({
      files: [htmlFile('alpha'), htmlFile('beta', 'GIFT-RAN-OUT')],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      expect.any(Number)
    );
  }, 20_000);

  it('is delivered and counted under the limit, as before', async () => {
    const { settled, users } = await upload({
      files: [htmlFile('alpha')],
      cardsUsed: 0,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      CLAUDE_CARDS_PER_FILE
    );
  }, 20_000);
});

describe('a deck the gift did not pay for keeps the monthly card limit', () => {
  it('fails at the limit when the gift ran out before Claude made any card and the parser made them all', async () => {
    const { status, settled, users } = await upload({
      files: [
        htmlFile('alpha', 'GIFT-RAN-OUT'),
        htmlFile('beta', 'GIFT-RAN-OUT'),
      ],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(status()).toBe(202);
    expect(await settled).toMatch(/^failed: \{"code":"monthly_limit"/);
    expect(users.incrementCardUsage).not.toHaveBeenCalled();
  }, 20_000);

  it.each([
    ['a free account with no gift', giftReaders({ grant: null }), claudeOn],
    [
      'a gift holder whose credits are used up',
      giftReaders({ spendUsd: SPENT_GIFT_USD }),
      claudeOn,
    ],
    [
      'a gift holder whose gift expired',
      giftReaders({ grant: expiredGrant }),
      claudeOn,
    ],
    [
      'an account while the gift is off',
      giftReaders({ enabled: false }),
      claudeOn,
    ],
    [
      'a request that sends the gift switch when no gift pays',
      giftReaders({ grant: null }),
      { ...claudeOn, 'ai-gift-switch': 'true' },
    ],
    [
      "a gift holder's upload with Claude off",
      giftReaders(),
      { 'claude-ai-flashcards': 'false' },
    ],
  ])(
    'sends %s to the limit wall',
    async (_label, readers, body) => {
      const { redirectedTo, jobs, users } = await upload({
        files: TWO_CLAUDE_FILES,
        cardsUsed: MONTHLY_CARD_LIMIT - 5,
        locals: FREE,
        readers,
        body,
      });

      expect(jobs.create).not.toHaveBeenCalled();
      expect(redirectedTo()).toEqual(cardLimitWall);
      expect(users.incrementCardUsage).not.toHaveBeenCalled();
    },
    20_000
  );

  it.each([
    ['a paying account', PAYING],
    ['a pass holder', PASS_HOLDER],
  ])(
    'delivers %s past 100 cards on its own rules, as before',
    async (_label, locals) => {
      const { status, settled, users } = await upload({
        files: TWO_CLAUDE_FILES,
        cardsUsed: MONTHLY_CARD_LIMIT,
        locals,
        readers: giftReaders(),
      });

      expect(status()).toBe(202);
      expect(await settled).toBe('delivered');
      expect(users.incrementCardUsage).toHaveBeenCalledWith(
        OWNER,
        TWO_CLAUDE_CARDS
      );
    },
    20_000
  );
});

describe('a restarted Claude job past the monthly card limit', () => {
  function restartService(readers: () => UploadGiftModeDeps) {
    const users = usersWith(MONTHLY_CARD_LIMIT - 5);
    const { jobs, settled } = settlingJobs();
    const service = new UploadService(
      recordingUploads(),
      jobs as unknown as JobRepository,
      users as unknown as UsersRepository,
      ...fakeUploadServiceDeps(),
      undefined,
      readers
    );
    const workspaceDir = path.join(workspaceBase, 'job-ws');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, 'page.html'), notionPage('gamma'));
    return { service, users, jobs, settled };
  }

  async function restart(readers: () => UploadGiftModeDeps) {
    const { service, users, jobs, settled } = restartService(readers);
    const response = responseWith(FREE);
    await service.restartClaudeJob(
      { params: { jobId: 'job-ws' } } as unknown as express.Request,
      response.res
    );
    return { status: response.status(), users, jobs, settled };
  }

  it('is delivered when the gift pays for the restart, and its cards count', async () => {
    const { status, settled, users } = await restart(giftReaders());

    expect(status).toBe(202);
    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      CLAUDE_CARDS_PER_FILE
    );
  }, 20_000);

  it('still fails at the limit while the gift is off', async () => {
    const { settled, users, jobs } = await restart(
      giftReaders({ enabled: false })
    );

    expect(await settled).toMatch(/^failed: \{"code":"monthly_limit"/);
    expect(users.incrementCardUsage).not.toHaveBeenCalled();
    expect(jobs.deleteJob as Mock).not.toHaveBeenCalled();
  }, 20_000);
});
