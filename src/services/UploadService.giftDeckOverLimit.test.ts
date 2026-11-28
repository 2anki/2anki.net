import { vi, type Mock } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type express from 'express';
import { zipSync } from 'fflate';

const storedKeys = vi.hoisted(() => [] as string[]);
const storedBodies = vi.hoisted(() => [] as string[]);
const builtCardCounts = vi.hoisted(() => [] as number[]);

vi.mock('@aws-sdk/client-s3', async (importActual) => {
  const actual = await importActual<typeof import('@aws-sdk/client-s3')>();
  class RecordingS3Client {
    async send(command: { input?: { Key?: string; Body?: unknown } }) {
      if (command instanceof actual.PutObjectCommand) {
        storedKeys.push(command.input?.Key ?? '');
        storedBodies.push(String(command.input?.Body ?? ''));
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
      const deckInfo = JSON.parse(
        fs.readFileSync(
          path.join(this.currentDirectory, 'deck_info.json'),
          'utf8'
        )
      ) as { name?: string; cards: unknown[] }[];
      const cards = deckInfo.reduce((sum, deck) => sum + deck.cards.length, 0);
      builtCardCounts.push(cards);
      const deckName = (deckInfo[0]?.name ?? 'deck').replace(/[^\w-]/g, '_');
      const apkgPath = path.join(this.currentDirectory, `${deckName}.apkg`);
      fs.writeFileSync(apkgPath, `cards:${cards}`);
      return apkgPath;
    }
  },
}));

const CLAUDE_CARDS_PER_FILE = vi.hoisted(() => 20);
const giftCalls = vi.hoisted(() => ({
  allowed: null as number | null,
  made: 0,
}));
const claudeCardsFor = vi.hoisted(() => (html: string) => {
  if (html.includes('HUGE-DECK')) return 150;
  if (html.includes('BIG-DECK')) return 100;
  return 20;
});

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
      if (html.includes('CLAUDE-DECLINES')) {
        throw new actual.ClaudeRefusalError();
      }
      if (giftCalls.allowed != null && giftCalls.made >= giftCalls.allowed) {
        throw new guard.AiCreditsExhaustedError();
      }
      giftCalls.made += 1;
      const topic = /<title>(.*?)<\/title>/.exec(html)?.[1] ?? 'notes';
      return [
        {
          name: topic,
          image: '',
          style: null,
          id: topic.length * 1000 + 7,
          settings: { template: 'specialstyle' },
          cards: Array.from({ length: claudeCardsFor(html) }, (_, i) => ({
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

const budgetGiftReaders = vi.hoisted(() => ({
  current: null as null | (() => unknown),
}));

vi.mock('../data_layer/createAiGiftReaders', async (importActual) => {
  const actual =
    await importActual<typeof import('../data_layer/createAiGiftReaders')>();
  return {
    ...actual,
    createAiGiftReaders: () => {
      if (budgetGiftReaders.current == null) {
        throw new Error('no gift readers for the budget read in this test');
      }
      return budgetGiftReaders.current();
    },
  };
});

const recordedEvents = vi.hoisted(
  () => [] as { name: string; props: Record<string, unknown> }[]
);

vi.mock('./events/eventsSinkInstance', () => ({
  getEventsSink: () => ({
    record: (event: { name: string; props: Record<string, unknown> }) => {
      recordedEvents.push(event);
    },
    flushDurable: () => Promise.resolve(),
  }),
  resetEventsSinkForTesting: () => undefined,
}));

import UploadService from './UploadService';
import type { UploadedFile } from '../lib/storage/types';
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
import {
  AiCreditsExhaustedError,
  getAiBudgetStatus,
} from '../lib/claude/aiSpendGuard';
import { jobFailureReasonFromError } from '../usecases/jobs/jobFailureReason';
import { generateDeckInfo } from '../lib/claude/ClaudeService';
import { AI_GIFT_MIN_MONTHLY_CARDS } from '../lib/claude/aiCredits/gift/giftTerms';
import { AI_GIFT_CLAUDE_CARDS_PER_JOB } from '../lib/claude/aiCredits/gift/giftCardAllowance';
import { runUploadGenerationInWorker } from '../usecases/uploads/worker';
import Workspace from '../lib/parser/WorkSpace';
import CardOption from '../lib/parser/Settings/CardOption';

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

function notionPage(
  topic: string,
  marker = '',
  toggleCount = CLAUDE_CARDS_PER_FILE
): Buffer {
  const toggles = Array.from(
    { length: toggleCount },
    (_, i) =>
      `<ul class="toggle"><li><details open=""><summary>${topic} front ${i}</summary><p>${topic} back ${i}</p></details></li></ul>`
  ).join('');
  return Buffer.from(
    `<html><head><title>${topic}</title></head><body><article class="page sans"><header><h1 class="page-title">${topic}</h1></header><div class="page-body">${marker}${toggles}</div></article></body></html>`
  );
}

function htmlFile(
  topic: string,
  marker = '',
  toggleCount = CLAUDE_CARDS_PER_FILE
) {
  const buffer = notionPage(topic, marker, toggleCount);
  return {
    originalname: `${topic}.html`,
    mimetype: 'text/html',
    buffer,
    size: buffer.length,
  };
}

function csvFile(cards: number) {
  const buffer = Buffer.from(
    Array.from(
      { length: cards },
      (_, i) => `csv front ${i},csv back ${i}`
    ).join('\n')
  );
  return {
    originalname: 'extra.csv',
    mimetype: 'text/csv',
    buffer,
    size: buffer.length,
  };
}

function ankiAppXmlFile(cards: number, deckName = 'Bulk') {
  const body = Array.from(
    { length: cards },
    (_, i) =>
      `<card><field name="Front">bulk front ${i}</field><field name="Back">bulk back ${i}</field></card>`
  ).join('');
  const buffer = Buffer.from(
    `<deck name="${deckName}"><fields><text name="Front" sides="10"></text><text name="Back" sides="01"></text></fields><cards>${body}</cards></deck>`
  );
  return {
    originalname: 'bulk.xml',
    mimetype: 'application/xml',
    buffer,
    size: buffer.length,
  };
}

function zipFile(name: string, entries: Record<string, Buffer>) {
  const buffer = Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(entries).map(([entry, bytes]) => [
          entry,
          new Uint8Array(bytes),
        ])
      )
    )
  );
  return {
    originalname: name,
    mimetype: 'application/zip',
    buffer,
    size: buffer.length,
  };
}

function manyClaudeFiles(count: number, topic: (i: number) => string) {
  return Array.from({ length: count }, (_, i) => ({
    ...htmlFile(topic(i)),
    originalname: `notes-${i}.html`,
  }));
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

function apkgsInWorkspaces(): string[] {
  return fs
    .readdirSync(workspaceBase, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.apkg'))
    .map((entry) => path.basename(entry))
    .sort((a, b) => a.localeCompare(b));
}

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
  storedBodies.length = 0;
  recordedEvents.length = 0;
  giftCalls.allowed = null;
  giftCalls.made = 0;
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
  const uploads = recordingUploads();
  const service = new UploadService(
    uploads,
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
  return { ...response, jobs, settled, users, uploads };
}

function cardsInStoredDecks(): number {
  return storedBodies.reduce(
    (sum, body) => sum + Number(body.replace('cards:', '')),
    0
  );
}

function sortedStoredBodies(): string[] {
  return [...storedBodies].sort((a, b) => a.localeCompare(b));
}

describe('a Claude deck the free AI credits gift paid for, past the monthly card limit', () => {
  it.each([
    ['on the web', FREE, claudeOn],
    ['from an MCP client', MCP_FREE, claudeOn],
    ['from the app', FREE, { ...claudeOn, source: 'app' }],
    ['from a Dropbox import', FREE, { ...claudeOn, source: 'dropbox' }],
    [
      'from a Google Drive import',
      FREE,
      { ...claudeOn, source: 'google_drive' },
    ],
  ])(
    'is stored in My decks %s instead of failing, and all its cards count toward the month',
    async (_entry, locals, body) => {
      const { status, settled, users } = await upload({
        files: TWO_CLAUDE_FILES,
        cardsUsed: CARDS_USED_LEAVING_25,
        locals,
        body,
      });

      expect(status()).toBe(202);
      expect(await settled).toBe('delivered');
      expect(storedKeys).toHaveLength(2);
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

  it('is delivered when the gift ran out after Claude made one file and the parser made the other within what is left', async () => {
    const { settled, users } = await upload({
      files: [htmlFile('alpha'), htmlFile('beta', 'GIFT-RAN-OUT')],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      TWO_CLAUDE_CARDS
    );
  }, 20_000);

  it('leaves out a 5000-card file its own converter made beside a small Claude file, delivering and counting only the Claude cards', async () => {
    const { settled, users } = await upload({
      files: [htmlFile('alpha'), ankiAppXmlFile(5000)],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      CLAUDE_CARDS_PER_FILE
    );
    expect(apkgsInWorkspaces()).toEqual(['alpha.apkg']);
    expect(storedBodies).toEqual([`cards:${CLAUDE_CARDS_PER_FILE}`]);
  }, 30_000);

  it('is delivered when the cards Claude did not make fill exactly what is left of the month', async () => {
    const { settled, users } = await upload({
      files: [htmlFile('alpha'), ankiAppXmlFile(25)],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      CLAUDE_CARDS_PER_FILE + 25
    );
  }, 20_000);

  it('holds a parser-read CSV back to the cards left in the month instead of refusing the job', async () => {
    const { settled, users } = await upload({
      files: [htmlFile('alpha'), csvFile(30)],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      CLAUDE_CARDS_PER_FILE + 25
    );
  }, 20_000);

  it('leaves out a file whose cards Claude did not make pass what is left by one, delivering the Claude cards', async () => {
    const { settled, users } = await upload({
      files: [htmlFile('alpha'), ankiAppXmlFile(26)],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      CLAUDE_CARDS_PER_FILE
    );
    expect(apkgsInWorkspaces()).toEqual(['alpha.apkg']);
  }, 20_000);

  it('keeps a later file that still fits after leaving out one that does not', async () => {
    const { settled, users } = await upload({
      files: [htmlFile('alpha'), ankiAppXmlFile(30), csvFile(10)],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      CLAUDE_CARDS_PER_FILE + 10
    );
    expect(apkgsInWorkspaces()).not.toContain('Bulk.apkg');
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

describe('the Claude card allowance of one gift-paid job', () => {
  it('caps 21 Claude files with 20 cards left at the allowance of 100 cards in total', async () => {
    vi.mocked(generateDeckInfo).mockClear();
    const { settled, users } = await upload({
      files: manyClaudeFiles(21, (i) => `topic${i}`),
      cardsUsed: MONTHLY_CARD_LIMIT - 20,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      AI_GIFT_CLAUDE_CARDS_PER_JOB
    );
    expect(vi.mocked(generateDeckInfo).mock.calls.length).toBeLessThan(21);
  }, 30_000);

  it('caps 21 copies of the same content at the allowance too', async () => {
    const { settled, users } = await upload({
      files: manyClaudeFiles(21, () => 'alpha'),
      cardsUsed: MONTHLY_CARD_LIMIT - 20,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      AI_GIFT_CLAUDE_CARDS_PER_JOB
    );
  }, 30_000);
});

describe('a gift-paid job whose allowance is used up', () => {
  it('makes no Claude call for a later file, so it spends no gift credits', async () => {
    vi.mocked(generateDeckInfo).mockClear();
    const { settled, users } = await upload({
      files: [
        zipFile('big.zip', { 'big.html': notionPage('big', 'BIG-DECK') }),
        htmlFile('beta'),
      ],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(generateDeckInfo).toHaveBeenCalledTimes(1);
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      AI_GIFT_CLAUDE_CARDS_PER_JOB
    );
  }, 20_000);
});

describe('a gift-paid job whose allowance is used up, then a file Claude never reads', () => {
  it('still builds that file with the parser and delivers its cards', async () => {
    const { settled, users } = await upload({
      files: [
        zipFile('big.zip', { 'big.html': notionPage('big', 'BIG-DECK') }),
        csvFile(10),
      ],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      AI_GIFT_CLAUDE_CARDS_PER_JOB + 10
    );
  }, 20_000);
});

describe('an uploaded Notion export zip the gift pays for', () => {
  const twoPageExport = () =>
    zipFile('export.zip', {
      'alpha.html': notionPage('alpha'),
      'beta.html': notionPage('beta'),
    });

  it('is delivered past the limit and counted, Claude making its cards', async () => {
    vi.mocked(generateDeckInfo).mockClear();

    const { status, settled, users } = await upload({
      files: [twoPageExport()],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(status()).toBe(202);
    expect(await settled).toBe('delivered');
    expect(generateDeckInfo).toHaveBeenCalledTimes(2);
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      TWO_CLAUDE_CARDS
    );
  }, 20_000);

  it('is delivered under the limit and counted', async () => {
    const { settled, users } = await upload({
      files: [twoPageExport()],
      cardsUsed: 0,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      TWO_CLAUDE_CARDS
    );
  }, 20_000);

  it('leaves out a large non-Claude file beside it and delivers the Claude cards', async () => {
    const { settled, users } = await upload({
      files: [twoPageExport(), ankiAppXmlFile(5000)],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      TWO_CLAUDE_CARDS
    );
    expect(apkgsInWorkspaces()).not.toContain('Bulk.apkg');
  }, 30_000);
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

  it('records the monthly limit as the reason the conversion failed', async () => {
    const { settled } = await upload({
      files: [
        htmlFile('alpha', 'GIFT-RAN-OUT'),
        htmlFile('beta', 'GIFT-RAN-OUT'),
      ],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });
    await settled;

    expect(
      recordedEvents
        .filter((event) => event.name === 'conversion_failed')
        .map((event) => event.props.reason)
    ).toEqual(['monthly_limit']);
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
  function restartService(
    readers: () => UploadGiftModeDeps,
    cardsUsed: number,
    pages: number
  ) {
    const users = usersWith(cardsUsed);
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
    for (let page = 0; page < pages; page++) {
      fs.writeFileSync(
        path.join(workspaceDir, `page-${page}.html`),
        notionPage(`gamma${page}`)
      );
    }
    return { service, users, jobs, settled };
  }

  async function restart(
    readers: () => UploadGiftModeDeps,
    {
      cardsUsed = MONTHLY_CARD_LIMIT - 5,
      pages = 1,
      locals = FREE,
    }: {
      cardsUsed?: number;
      pages?: number;
      locals?: Record<string, unknown>;
    } = {}
  ) {
    const { service, users, jobs, settled } = restartService(
      readers,
      cardsUsed,
      pages
    );
    const response = responseWith(locals);
    await service.restartClaudeJob(
      { params: { jobId: 'job-ws' } } as unknown as express.Request,
      response.res
    );
    return { status: response.status(), users, jobs, settled };
  }

  it('is delivered when the gift pays for the restart, and its cards count', async () => {
    const { status, settled, users } = await restart(giftReaders(), {
      cardsUsed: MONTHLY_CARD_LIMIT - AI_GIFT_MIN_MONTHLY_CARDS,
      pages: 2,
    });

    expect(status).toBe(202);
    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      TWO_CLAUDE_CARDS
    );
  }, 20_000);

  it('delivers an interrupted gift job restarted with the minimum cards left within the job allowance', async () => {
    const { settled, users } = await restart(giftReaders(), {
      cardsUsed: MONTHLY_CARD_LIMIT - AI_GIFT_MIN_MONTHLY_CARDS,
      pages: 6,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      AI_GIFT_CLAUDE_CARDS_PER_JOB
    );
  }, 20_000);

  it('refuses a gift restart in a month far past the limit before any Claude call', async () => {
    vi.mocked(generateDeckInfo).mockClear();

    const { settled, users } = await restart(giftReaders(), {
      cardsUsed: 4 * MONTHLY_CARD_LIMIT,
    });

    expect(await settled).toMatch(/^failed: \{"code":"monthly_limit"/);
    expect(generateDeckInfo).not.toHaveBeenCalled();
    expect(users.incrementCardUsage).not.toHaveBeenCalled();
  }, 20_000);

  it('refuses a gift restart with one card fewer than the minimum left', async () => {
    const { settled, users } = await restart(giftReaders(), {
      cardsUsed: MONTHLY_CARD_LIMIT - AI_GIFT_MIN_MONTHLY_CARDS + 1,
    });

    expect(await settled).toMatch(/^failed: \{"code":"monthly_limit"/);
    expect(users.incrementCardUsage).not.toHaveBeenCalled();
  }, 20_000);

  it('still fails at the limit while the gift is off', async () => {
    const { settled, users, jobs } = await restart(
      giftReaders({ enabled: false })
    );

    expect(await settled).toMatch(/^failed: \{"code":"monthly_limit"/);
    expect(users.incrementCardUsage).not.toHaveBeenCalled();
    expect(jobs.deleteJob as Mock).not.toHaveBeenCalled();
  }, 20_000);

  it.each([
    ['used up', giftReaders({ spendUsd: SPENT_GIFT_USD })],
    ['expired', giftReaders({ grant: expiredGrant })],
  ])(
    'stops on a gift that is %s before any delivery, the real budget read refusing',
    async (_state, readers) => {
      const actualGuard = await vi.importActual<
        typeof import('../lib/claude/aiSpendGuard')
      >('../lib/claude/aiSpendGuard');
      budgetGiftReaders.current = readers;
      vi.mocked(getAiBudgetStatus).mockImplementationOnce(
        actualGuard.getAiBudgetStatus
      );

      const { settled, users, jobs } = await restart(readers, {
        cardsUsed: 0,
      });

      expect(await settled).toBe(
        `failed: ${jobFailureReasonFromError(new AiCreditsExhaustedError(), 'job-ws')}`
      );
      expect(users.incrementCardUsage).not.toHaveBeenCalled();
      expect(jobs.deleteJob as Mock).not.toHaveBeenCalled();
      budgetGiftReaders.current = null;
    },
    20_000
  );

  it.each([
    ['a paying account on its plan', PAYING, giftReaders({ grant: null })],
    ['a paying account drawing on the gift', PAYING, giftReaders()],
    ['a pass holder', PASS_HOLDER, giftReaders({ grant: null })],
  ])(
    'delivers the restart of %s past the limit and counts it, as before',
    async (_label, locals, readers) => {
      const { settled, users } = await restart(readers, {
        cardsUsed: 2 * MONTHLY_CARD_LIMIT,
        pages: 6,
        locals,
      });

      expect(await settled).toBe('delivered');
      expect(users.incrementCardUsage).toHaveBeenCalledWith(
        OWNER,
        6 * CLAUDE_CARDS_PER_FILE
      );
    },
    20_000
  );

  it('refuses the restart of a free account with no gift past the limit, as before', async () => {
    const { settled, users } = await restart(giftReaders({ grant: null }), {
      cardsUsed: MONTHLY_CARD_LIMIT - 5,
    });

    expect(await settled).toMatch(/^failed: \{"code":"monthly_limit"/);
    expect(users.incrementCardUsage).not.toHaveBeenCalled();
  }, 20_000);

  it.each([
    ['a free account with no gift', FREE],
    ['a paying account', PAYING],
  ])(
    'delivers the restart of %s under the limit and counts it, as before',
    async (_label, locals) => {
      const { settled, users } = await restart(giftReaders({ grant: null }), {
        cardsUsed: 0,
        locals,
      });

      expect(await settled).toBe('delivered');
      expect(users.incrementCardUsage).toHaveBeenCalledWith(
        OWNER,
        CLAUDE_CARDS_PER_FILE
      );
    },
    20_000
  );
});

describe('a pass with no account and no gift, Claude on', () => {
  const PASS_LOCALS = {
    subscriber: true,
    passKind: 'day',
    passExpiresAt: '2026-11-28T00:00:00.000Z',
    anonymousPassId: 7,
  };

  it('converts a signed-out Day Pass upload of two files with every Claude card, no cap', async () => {
    vi.mocked(generateDeckInfo).mockClear();
    builtCardCounts.length = 0;
    const { status } = await upload({
      files: [htmlFile('alpha', 'HUGE-DECK'), htmlFile('beta', 'HUGE-DECK')],
      cardsUsed: 0,
      locals: PASS_LOCALS,
    });

    expect(status()).toBe(200);
    expect(generateDeckInfo).toHaveBeenCalledTimes(2);
    expect(builtCardCounts.reduce((sum, n) => sum + n, 0)).toBe(300);
  }, 20_000);

  it('resumes a signed-out AI preview on the pass with every Claude card, no cap', async () => {
    vi.mocked(generateDeckInfo).mockClear();
    const service = new UploadService(
      recordingUploads(),
      settlingJobs().jobs as unknown as JobRepository,
      usersWith(0) as unknown as UsersRepository,
      ...fakeUploadServiceDeps(),
      undefined,
      giftReaders()
    );

    const conversion = await service.convertStoredFileWithAiForPass(
      7,
      htmlFile('alpha', 'HUGE-DECK') as unknown as UploadedFile,
      'preview-resume'
    );

    expect(generateDeckInfo).toHaveBeenCalledTimes(1);
    expect(conversion.cardCount).toBe(150);
  }, 20_000);
});

describe('uploads the gift does not pay for run the same worker with no allowance', () => {
  it("delivers a paying account's Claude zip in full, uncapped, as one package", async () => {
    vi.mocked(generateDeckInfo).mockClear();
    const { settled, users } = await upload({
      files: [
        zipFile('export.zip', {
          'one.html': notionPage('one', 'BIG-DECK'),
          'two.html': notionPage('two', 'BIG-DECK'),
        }),
      ],
      cardsUsed: MONTHLY_CARD_LIMIT,
      locals: PAYING,
    });

    expect(await settled).toBe('delivered');
    expect(generateDeckInfo).toHaveBeenCalledTimes(2);
    expect(storedKeys).toHaveLength(1);
    expect(users.incrementCardUsage).toHaveBeenCalledWith(OWNER, 200);
  }, 20_000);

  it('makes every Claude call for a paying account past 100 cards', async () => {
    vi.mocked(generateDeckInfo).mockClear();
    const { settled, users } = await upload({
      files: [
        zipFile('big.zip', { 'big.html': notionPage('big', 'BIG-DECK') }),
        htmlFile('beta'),
      ],
      cardsUsed: 0,
      locals: PAYING,
    });

    expect(await settled).toBe('delivered');
    expect(generateDeckInfo).toHaveBeenCalledTimes(2);
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      100 + CLAUDE_CARDS_PER_FILE
    );
  }, 20_000);

  it.each([
    ['a free single file', FREE, () => [htmlFile('alpha')], 20],
    [
      'a free zip',
      FREE,
      () => [
        zipFile('export.zip', {
          'alpha.html': notionPage('alpha'),
          'beta.html': notionPage('beta'),
        }),
      ],
      40,
    ],
    ['a free multi-file upload', FREE, () => TWO_CLAUDE_FILES, 40],
    ['a synchronous MCP upload', MCP_FREE, () => [htmlFile('alpha')], 20],
  ])(
    'converts %s without Claude with every parser card, counted as before',
    async (_label, locals, files, cards) => {
      vi.mocked(generateDeckInfo).mockClear();
      const { status, jobs, users } = await upload({
        files: files(),
        cardsUsed: 0,
        locals,
        body: { 'claude-ai-flashcards': 'false' },
      });

      expect(status()).toBe(200);
      expect(jobs.create).not.toHaveBeenCalled();
      expect(generateDeckInfo).not.toHaveBeenCalled();
      expect(users.incrementCardUsage).toHaveBeenCalledWith(OWNER, cards);
    },
    20_000
  );

  it('converts a synchronous app upload without Claude, counted as before', async () => {
    const { status, users } = await upload({
      files: [htmlFile('alpha')],
      cardsUsed: 0,
      locals: FREE,
      body: { 'claude-ai-flashcards': 'false', source: 'app' },
    });

    expect(status()).toBe(200);
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      CLAUDE_CARDS_PER_FILE
    );
  }, 20_000);

  it('converts a signed-out upload without Claude and counts nothing', async () => {
    const { status, users } = await upload({
      files: [htmlFile('alpha')],
      cardsUsed: 0,
      locals: {},
      body: { 'claude-ai-flashcards': 'false' },
    });

    expect(status()).toBe(200);
    expect(users.incrementCardUsage).not.toHaveBeenCalled();
  }, 20_000);
});

describe('a gift-paid job whose files the gift could not pay for pass the month together', () => {
  const PARSER_CARDS_PER_FILE = 80;

  it('delivers the Claude cards and the parser files that fit, when the gift paid for one file of three', async () => {
    const { settled, users } = await upload({
      files: [
        htmlFile('alpha'),
        htmlFile('beta', 'GIFT-RAN-OUT', PARSER_CARDS_PER_FILE),
        htmlFile('gamma', 'GIFT-RAN-OUT', PARSER_CARDS_PER_FILE),
      ],
      cardsUsed: 0,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      CLAUDE_CARDS_PER_FILE + PARSER_CARDS_PER_FILE
    );
    expect(apkgsInWorkspaces()).toEqual(['alpha.apkg', 'beta.apkg']);
  }, 30_000);

  it('delivers the Claude cards when two Claude calls ran for the first file and the gift refused the rest', async () => {
    giftCalls.allowed = 2;
    vi.mocked(generateDeckInfo).mockClear();

    const { settled, users } = await upload({
      files: [
        zipFile('lecture.zip', {
          'alpha.html': notionPage('alpha'),
          'beta.html': notionPage('beta'),
        }),
        htmlFile('gamma', '', PARSER_CARDS_PER_FILE),
        htmlFile('delta', '', PARSER_CARDS_PER_FILE),
      ],
      cardsUsed: 0,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(giftCalls.made).toBe(2);
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      TWO_CLAUDE_CARDS + PARSER_CARDS_PER_FILE
    );
    expect(apkgsInWorkspaces()).not.toContain('delta.apkg');
  }, 30_000);
});

describe('a job with a card limit and no gift mode', () => {
  it.each([
    ['paying', true, OWNER, 'claude'],
    ['signed out with no pass', false, null, 'parser'],
  ])(
    'leaves no file out when %s, even beside cards past the limit',
    async (_label, paying, userId, engine) => {
      const result = await runUploadGenerationInWorker({
        paying: paying as boolean,
        files: [
          htmlFile('alpha'),
          ankiAppXmlFile(5000),
        ] as unknown as UploadedFile[],
        settings: new CardOption(claudeOn),
        workspace: new Workspace(true, 'fs'),
        enqueuedAt: Date.now(),
        userId: userId as number | null,
        cardLimit: 25,
      });

      expect(result.ok).toBe(true);
      expect(
        result.ok ? result.packages.map((p) => [p.engine, p.cardCount]) : []
      ).toEqual([
        [engine, CLAUDE_CARDS_PER_FILE],
        [undefined, 5000],
      ]);
      expect(apkgsInWorkspaces()).toContain('Bulk.apkg');
    },
    30_000
  );
});

describe('a gift-paid job in sequence whose decks share a name', () => {
  const claudeZip = () =>
    zipFile('lecture.zip', { 'alpha.html': notionPage('alpha') });

  it.each([
    ['after', () => [claudeZip(), ankiAppXmlFile(500, 'alpha')]],
    ['before', () => [ankiAppXmlFile(500, 'alpha'), claudeZip()]],
  ])(
    'stores the Claude deck with its own cards when a left-out file of the same name comes %s it',
    async (_order, files) => {
      const { settled, users } = await upload({
        files: files(),
        cardsUsed: CARDS_USED_LEAVING_25,
        locals: FREE,
      });

      expect(await settled).toBe('delivered');
      expect(storedBodies).toEqual([`cards:${CLAUDE_CARDS_PER_FILE}`]);
      expect(users.incrementCardUsage).toHaveBeenCalledWith(
        OWNER,
        CLAUDE_CARDS_PER_FILE
      );
      expect(apkgsInWorkspaces()).toHaveLength(1);
    },
    30_000
  );

  it('keeps, stores and counts both decks of the same name when both fit, under distinct names', async () => {
    const { settled, users } = await upload({
      files: [claudeZip(), ankiAppXmlFile(30, 'alpha')],
      cardsUsed: 0,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      CLAUDE_CARDS_PER_FILE + 30
    );
    expect(apkgsInWorkspaces()).toEqual(['alpha (2).apkg', 'alpha.apkg']);
    expect(sortedStoredBodies()).toEqual([
      `cards:${CLAUDE_CARDS_PER_FILE}`,
      'cards:30',
    ]);
  }, 30_000);
});

describe('a job in sequence the gift does not pay for', () => {
  it('converts a free zip and another file without Claude, every deck kept and counted as before', async () => {
    const { status, users } = await upload({
      files: [
        zipFile('export.zip', { 'alpha.html': notionPage('alpha') }),
        htmlFile('beta'),
      ],
      cardsUsed: 0,
      locals: FREE,
      body: { 'claude-ai-flashcards': 'false' },
    });

    expect(status()).toBe(200);
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      TWO_CLAUDE_CARDS
    );
    expect(apkgsInWorkspaces()).toEqual(['alpha.apkg', 'beta.apkg']);
  }, 30_000);
});

describe('an async job of several Claude files', () => {
  it.each([
    ['a paying account', PAYING, 0],
    ['a pass holder', PASS_HOLDER, 0],
    ['a gift holder', FREE, 0],
    ['a gift holder past the monthly limit', FREE, CARDS_USED_LEAVING_25],
  ])(
    'stores every deck of two files for %s and counts exactly their cards',
    async (_label, locals, cardsUsed) => {
      const { settled, users, uploads } = await upload({
        files: TWO_CLAUDE_FILES,
        cardsUsed,
        locals,
      });

      expect(await settled).toBe('delivered');
      expect(sortedStoredBodies()).toEqual([
        `cards:${CLAUDE_CARDS_PER_FILE}`,
        `cards:${CLAUDE_CARDS_PER_FILE}`,
      ]);
      expect(new Set(storedKeys).size).toBe(2);
      expect(
        vi.mocked(uploads.update).mock.calls.map((call) => call[1])
      ).toEqual(['alpha.apkg', 'beta.apkg']);
      expect(users.incrementCardUsage).toHaveBeenCalledTimes(1);
      expect(users.incrementCardUsage).toHaveBeenCalledWith(
        OWNER,
        cardsInStoredDecks()
      );
    },
    20_000
  );

  it('stores all three decks of three files under three keys', async () => {
    const { settled, users, uploads } = await upload({
      files: [htmlFile('alpha'), htmlFile('beta'), htmlFile('gamma')],
      cardsUsed: 0,
      locals: PAYING,
    });

    expect(await settled).toBe('delivered');
    expect(storedBodies).toHaveLength(3);
    expect(new Set(storedKeys).size).toBe(3);
    expect(
      vi.mocked(uploads.update).mock.calls.map((call) => [call[1], call[2]])
    ).toEqual([
      ['alpha.apkg', storedKeys[0]],
      ['beta.apkg', storedKeys[1]],
      ['gamma.apkg', storedKeys[2]],
    ]);
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      3 * CLAUDE_CARDS_PER_FILE
    );
    expect(cardsInStoredDecks()).toBe(3 * CLAUDE_CARDS_PER_FILE);
  }, 20_000);

  it('keeps a single-file job on one key named after the job, one row and its own cards', async () => {
    const { settled, users, uploads, body } = await upload({
      files: [htmlFile('alpha')],
      cardsUsed: 0,
      locals: PAYING,
    });

    expect(await settled).toBe('delivered');
    const { jobId } = body() as { jobId: string };
    expect(storedKeys).toEqual([
      expect.stringMatching(new RegExp(`^${OWNER}-\\d+-${jobId}\\.apkg$`)),
    ]);
    expect(uploads.update).toHaveBeenCalledTimes(1);
    expect(uploads.update).toHaveBeenCalledWith(
      OWNER,
      'alpha.apkg',
      storedKeys[0],
      expect.any(Number),
      null,
      { skippedAiFiles: [] }
    );
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      CLAUDE_CARDS_PER_FILE
    );
  }, 20_000);

  it('notes a file Claude made nothing from on the first deck only, not on every deck', async () => {
    const { settled, uploads } = await upload({
      files: [
        htmlFile('alpha'),
        htmlFile('beta'),
        htmlFile('gamma', 'CLAUDE-DECLINES'),
      ],
      cardsUsed: 0,
      locals: PAYING,
    });

    expect(await settled).toBe('delivered');
    expect(
      vi
        .mocked(uploads.update)
        .mock.calls.map((call) => [call[1], call[5]?.skippedAiFiles])
    ).toEqual([
      ['alpha.apkg', [{ name: 'gamma.html', reason: 'declined' }]],
      ['beta.apkg', []],
    ]);
  }, 20_000);

  it('stores only the decks a gift job kept when a file is left out of the month', async () => {
    const { settled, users } = await upload({
      files: [htmlFile('alpha'), ankiAppXmlFile(30), csvFile(10)],
      cardsUsed: CARDS_USED_LEAVING_25,
      locals: FREE,
    });

    expect(await settled).toBe('delivered');
    expect(sortedStoredBodies()).toEqual([
      'cards:10',
      `cards:${CLAUDE_CARDS_PER_FILE}`,
    ]);
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      cardsInStoredDecks()
    );
  }, 30_000);
});

describe('a restarted Claude job of several files', () => {
  async function restartWith(staleDecks: Record<string, string>) {
    const users = usersWith(0);
    const { jobs, settled } = settlingJobs();
    const uploads = recordingUploads();
    const service = new UploadService(
      uploads,
      jobs as unknown as JobRepository,
      users as unknown as UsersRepository,
      ...fakeUploadServiceDeps(),
      undefined,
      giftReaders({ grant: null })
    );
    const workspaceDir = path.join(workspaceBase, 'job-ws');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceDir, 'one.html'), notionPage('alpha'));
    fs.writeFileSync(path.join(workspaceDir, 'two.html'), notionPage('beta'));
    for (const [name, content] of Object.entries(staleDecks)) {
      fs.writeFileSync(path.join(workspaceDir, name), content);
    }
    const response = responseWith(PAYING);
    await service.restartClaudeJob(
      { params: { jobId: 'job-ws' } } as unknown as express.Request,
      response.res
    );
    return { settled, users, uploads };
  }

  it('stores the one package it builds with every file and counts its cards', async () => {
    const { settled, users } = await restartWith({});

    expect(await settled).toBe('delivered');
    expect(storedBodies).toEqual([`cards:${TWO_CLAUDE_CARDS}`]);
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      TWO_CLAUDE_CARDS
    );
  }, 20_000);

  it('stores only what the restart built, never a deck an earlier run left in the workspace', async () => {
    const { settled, users } = await restartWith({
      'aaa-earlier-run.apkg': 'cards:7',
      'beta.apkg': 'cards:9',
    });

    expect(await settled).toBe('delivered');
    expect(storedBodies).toEqual([`cards:${TWO_CLAUDE_CARDS}`]);
    expect(users.incrementCardUsage).toHaveBeenCalledWith(
      OWNER,
      cardsInStoredDecks()
    );
  }, 20_000);
});
