import { vi } from 'vitest';
import type express from 'express';

const recordedEvents = vi.hoisted(
  () => [] as { name: string; user_id: number | null; props: unknown }[]
);

vi.mock('@aws-sdk/client-s3', async (importActual) => {
  const actual = await importActual<typeof import('@aws-sdk/client-s3')>();
  class NoopS3Client {
    async send() {
      return {};
    }
  }
  return { ...actual, S3Client: NoopS3Client };
});

vi.mock('../lib/conversionPool', async (importActual) => {
  const actual = await importActual<typeof import('../lib/conversionPool')>();
  const worker = await import('../usecases/uploads/worker');
  return {
    ...actual,
    runUploadGeneration: worker.runUploadGenerationInWorker,
  };
});

vi.mock('../infrastracture/adapters/fileConversion/ConvertPPTToPDF', () => ({
  convertPPTToPDF: vi.fn().mockRejectedValue(new Error('no LibreOffice')),
}));

vi.mock('../lib/claude/ClaudeService', async (importActual) => {
  const actual =
    await importActual<typeof import('../lib/claude/ClaudeService')>();
  return {
    ...actual,
    generateDeckInfo: vi.fn().mockRejectedValue(new Error('not reached')),
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
    record: (row: { name: string; user_id: number | null; props: unknown }) =>
      recordedEvents.push(row),
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
import { AI_CHOICE_AT_KEY } from '../lib/upload/claudeCardsDefault';
import { getAiBudgetStatus } from '../lib/claude/aiSpendGuard';
import { fakeUploadServiceDeps } from '../test/fakes/uploadServiceDeps';
import type { UploadGiftModeDeps } from '../lib/claude/aiCredits/gift/uploadGiftMode';
import {
  resetGiftMarkers,
  takeGiftMarker,
} from '../lib/claude/aiCredits/gift/giftConversionMarker';
import { InMemoryAiCreditGiftsRepository } from '../data_layer/AiCreditGiftsRepository';
import {
  AI_GIFT_CREDITS_EXPIRE_BY,
  AI_GIFT_CREDITS_PER_CLAIM,
} from '../lib/claude/aiCredits/gift/giftTerms';

const OWNER = 42;
const PPTX_MIMETYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const noFeatureFlags: IFeatureFlagsRepository = {
  getAll: () => Promise.resolve([]),
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(null),
};

function uploads(): IUploadRepository {
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

function backgroundJobs() {
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const jobs = {
    create: vi.fn().mockResolvedValue(undefined),
    updateJobStatus: vi.fn(async (_id: string, _o: string, status: string) => {
      if (status === 'failed') settle();
    }),
    findJobById: vi.fn().mockResolvedValue({ id: 7 }),
    deleteJob: vi.fn(async () => settle()),
  };
  return { jobs, settled };
}

function mimetypeOf(name: string): string {
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.zip')) return 'application/zip';
  if (name.endsWith('.apkg')) return 'application/octet-stream';
  if (name.endsWith('.md')) return 'text/markdown';
  return PPTX_MIMETYPE;
}

interface Account {
  locals: Record<string, unknown>;
  stored?: Record<string, string> | null;
  latestToggle?: string | null;
  gift?: () => UploadGiftModeDeps;
  cardsUsed?: number;
}

const PAYING: Account = { locals: { owner: OWNER, subscriber: true } };
const FROM_SWITCH_ON = {
  'claude-ai-flashcards': 'true',
  'ai-gift-switch': 'true',
};
const FREE: Account = { locals: { owner: OWNER } };

interface Sent {
  name: string;
  body?: Record<string, string>;
  path?: string;
}

async function send(account: Account, file: Sent) {
  __setFeatureFlagDependencies({ repository: noFeatureFlags });
  const { jobs, settled } = backgroundJobs();
  const users = {
    getCardOptions: vi.fn().mockResolvedValue(account.stored ?? null),
    latestAiToggleEventName: vi
      .fn()
      .mockResolvedValue(account.latestToggle ?? null),
    getCardUsage: vi.fn().mockResolvedValue({
      cards_used: account.cardsUsed ?? 0,
      month_started_at: new Date('2026-11-01T00:00:00Z'),
    }),
    incrementCardUsage: vi.fn().mockResolvedValue(1),
  };
  const service = new UploadService(
    uploads(),
    jobs as unknown as JobRepository,
    users as unknown as UsersRepository,
    ...fakeUploadServiceDeps(),
    undefined,
    account.gift
  );
  const buffer = Buffer.from('not a real document');
  const req = {
    files: [
      {
        originalname: file.name,
        mimetype: mimetypeOf(file.name),
        buffer,
        size: buffer.length,
      },
    ],
    body: file.body ?? {},
    headers: {},
    cookies: {},
    path: file.path ?? '/api/upload/file',
  } as unknown as express.Request;
  let status = 0;
  const res = {
    locals: { requestId: 'claude-default', ...account.locals },
    headersSent: false,
    status: vi.fn((code: number) => {
      status = code;
      return res;
    }),
    json: vi.fn(() => res),
    set: vi.fn(() => res),
    send: vi.fn(() => res),
    contentType: vi.fn(() => res),
    redirect: vi.fn(() => res),
    setHeader: vi.fn(() => res),
    attachment: vi.fn(() => res),
    end: vi.fn(() => res),
  };

  await service.handleUpload(req, res as unknown as express.Response);
  if (jobs.create.mock.calls.length > 0) await settled;
  const jobType =
    (jobs.create.mock.calls[0]?.[3] as string | undefined) ?? null;
  return {
    status,
    jobType,
    users,
    locals: res.locals as Record<string, unknown>,
  };
}

function defaultAppliedEvents() {
  return recordedEvents.filter((e) => e.name === 'upload_ai_default_applied');
}

describe('a paying account uploads a PDF or PowerPoint on the web', () => {
  const warn = vi.spyOn(console, 'warn');
  const error = vi.spyOn(console, 'error');

  beforeEach(() => {
    warn.mockImplementation(() => undefined);
    error.mockImplementation(() => undefined);
  });

  afterEach(() => {
    __resetFeatureFlagModuleForTests();
    recordedEvents.length = 0;
  });

  it('makes Claude cards from a PDF when the account never chose a setting', async () => {
    const { status, jobType } = await send(PAYING, { name: 'lecture.pdf' });

    expect(status).toBe(202);
    expect(jobType).toBe('claude');
    expect(defaultAppliedEvents()).toEqual([
      expect.objectContaining({ user_id: OWNER, props: { format: 'pdf' } }),
    ]);
  }, 20_000);

  it.each([
    ['a Dropbox pick', '/api/upload/dropbox'],
    ['a Google Drive pick', '/api/upload/google_drive'],
  ])(
    'makes Claude cards from %s of a PDF, since it is a web upload',
    async (_label, path) => {
      const { jobType } = await send(PAYING, { name: 'lecture.pdf', path });

      expect(jobType).toBe('claude');
      expect(defaultAppliedEvents()).toHaveLength(1);
    },
    20_000
  );

  it('makes Claude cards for a lifetime Patreon account, who counts as paying', async () => {
    const { jobType } = await send(
      { locals: { owner: OWNER, patreon: true } },
      { name: 'lecture.pdf' }
    );

    expect(jobType).toBe('claude');
  }, 20_000);

  it('makes Claude cards for a signed-in pass holder, who counts as paying', async () => {
    const { jobType } = await send(
      { locals: { owner: OWNER, subscriber: true, passKind: '7d' } },
      { name: 'lecture.pdf' }
    );

    expect(jobType).toBe('claude');
  }, 20_000);

  it('keeps the parser and records no default when the account has no AI credits left', async () => {
    vi.mocked(getAiBudgetStatus).mockResolvedValueOnce({
      exhausted: true,
      balance: null,
    });

    const { status, jobType } = await send(PAYING, { name: 'lecture.pdf' });

    expect(status).not.toBe(202);
    expect(jobType).toBeNull();
    expect(defaultAppliedEvents()).toEqual([]);
  }, 20_000);

  it('keeps AI off for a PowerPoint when a stored off has no recorded toggle', async () => {
    const { jobType } = await send(
      { ...PAYING, stored: { 'claude-ai-flashcards': 'false' } },
      { name: 'slides.pptx', body: { 'claude-ai-flashcards': 'false' } }
    );

    expect(jobType).toBe('upload');
    expect(defaultAppliedEvents()).toEqual([]);
  }, 20_000);

  it('makes Claude cards from a PowerPoint when the stored off follows a recorded turn on', async () => {
    const { jobType } = await send(
      {
        ...PAYING,
        stored: { 'claude-ai-flashcards': 'false' },
        latestToggle: 'upload_ai_turned_on',
      },
      { name: 'slides.pptx', body: { 'claude-ai-flashcards': 'false' } }
    );

    expect(jobType).toBe('claude');
    expect(defaultAppliedEvents()).toEqual([
      expect.objectContaining({ props: { format: 'pptx' } }),
    ]);
  }, 20_000);

  it('keeps AI off for a PowerPoint when the account recorded turning it off', async () => {
    const { jobType } = await send(
      {
        ...PAYING,
        stored: {
          'claude-ai-flashcards': 'false',
          [AI_CHOICE_AT_KEY]: '1762300000',
        },
      },
      { name: 'slides.pptx' }
    );

    expect(jobType).toBe('upload');
    expect(defaultAppliedEvents()).toEqual([]);
  }, 20_000);

  it('keeps AI off when the latest AI toggle the account made was off', async () => {
    const { jobType } = await send(
      {
        ...PAYING,
        stored: { 'claude-ai-flashcards': 'false' },
        latestToggle: 'upload_ai_turned_off',
      },
      { name: 'slides.pptx' }
    );

    expect(jobType).toBe('upload');
  }, 20_000);

  it('keeps AI off for a PDF when the account recorded turning it off', async () => {
    const { status, jobType } = await send(
      {
        ...PAYING,
        stored: {
          'claude-ai-flashcards': 'false',
          [AI_CHOICE_AT_KEY]: '1762300000',
        },
      },
      { name: 'lecture.pdf' }
    );

    expect(status).not.toBe(202);
    expect(jobType).toBeNull();
  }, 20_000);
});

describe('uploads the Claude default does not reach', () => {
  const warn = vi.spyOn(console, 'warn');
  const error = vi.spyOn(console, 'error');

  beforeEach(() => {
    warn.mockImplementation(() => undefined);
    error.mockImplementation(() => undefined);
  });

  afterEach(() => {
    __resetFeatureFlagModuleForTests();
    recordedEvents.length = 0;
  });

  it('leaves a free account on the standard parser for a PDF', async () => {
    const { status, jobType, users } = await send(FREE, {
      name: 'lecture.pdf',
    });

    expect(status).not.toBe(202);
    expect(jobType).toBeNull();
    expect(users.latestAiToggleEventName).not.toHaveBeenCalled();
  }, 20_000);

  it('leaves a PowerPoint sent through MCP on the standard parser', async () => {
    const { jobType } = await send(
      { locals: { ...PAYING.locals, mcp_auth: true } },
      { name: 'slides.pptx' }
    );

    expect(jobType).toBe('upload');
    expect(defaultAppliedEvents()).toEqual([]);
  }, 20_000);

  it('leaves a PowerPoint sent from the iOS app on the standard parser', async () => {
    const { jobType } = await send(PAYING, {
      name: 'slides.pptx',
      body: { source: 'app' },
    });

    expect(jobType).toBe('upload');
    expect(defaultAppliedEvents()).toEqual([]);
  }, 20_000);
});

describe('an account with no plan whose free AI gift pays uploads on the web', () => {
  const warn = vi.spyOn(console, 'warn');
  const error = vi.spyOn(console, 'error');
  const grant = {
    id: 3,
    userId: OWNER,
    credits: 100,
    claimedAt: new Date('2026-11-25T10:00:00.000Z'),
    expiresAt: new Date('2099-11-27T10:00:00.000Z'),
  };
  const giftReaders =
    (
      options: {
        grant?: typeof grant | null;
        spendUsd?: number;
        enabled?: boolean;
      } = {}
    ) =>
    (): UploadGiftModeDeps => ({
      isEnabled: async () => options.enabled ?? true,
      findGrant: async () =>
        options.grant === undefined ? grant : options.grant,
      giftCostSince: async () => options.spendUsd ?? 0,
      now: () => new Date('2026-11-25T12:00:00.000Z'),
      planSpent: async () => false,
      startGrant: async () => null,
    });

  // The readers the upload uses, over the same grant store the guard and the
  // status read, so a test sees the grant the upload made.
  const storeReaders =
    (gifts: InMemoryAiCreditGiftsRepository) => (): UploadGiftModeDeps => ({
      isEnabled: async () => true,
      findGrant: (userId) => gifts.findGrant(userId),
      giftCostSince: (giftId, userId, since) =>
        gifts.giftCostSince(giftId, userId, since),
      now: () => new Date('2026-11-25T12:00:00.000Z'),
      planSpent: async () => false,
      startGrant: async (userId, ipHash, now) => {
        const outcome = await gifts.startGrant({
          userId,
          credits: AI_GIFT_CREDITS_PER_CLAIM,
          startedAt: now,
          expiresAt: AI_GIFT_CREDITS_EXPIRE_BY,
          ipHash,
        });
        return outcome.ok
          ? { grant: outcome.grant, created: outcome.created }
          : null;
      },
    });
  const GIFTED: Account = { locals: { owner: OWNER }, gift: giftReaders() };

  beforeEach(() => {
    resetGiftMarkers();
    process.env.THE_HASHING_SECRET = 'test-hashing-secret';
    warn.mockImplementation(() => undefined);
    error.mockImplementation(() => undefined);
    vi.mocked(getAiBudgetStatus).mockClear();
  });

  afterEach(() => {
    __resetFeatureFlagModuleForTests();
    recordedEvents.length = 0;
    resetGiftMarkers();
  });

  it('makes Claude cards from a PDF on the gift when the account never chose a setting', async () => {
    const { status, jobType } = await send(GIFTED, { name: 'lecture.pdf' });

    expect(status).toBe(202);
    expect(jobType).toBe('claude');
    expect(defaultAppliedEvents()).toEqual([
      expect.objectContaining({
        user_id: OWNER,
        props: { format: 'pdf', reason: 'gift' },
      }),
    ]);
  }, 20_000);

  it('checks the gift alone, never a bought or plan balance, before applying it', async () => {
    await send(GIFTED, { name: 'lecture.pdf' });

    expect(vi.mocked(getAiBudgetStatus)).toHaveBeenCalledWith({
      userId: OWNER,
      aiGift: 'only',
    });
  }, 20_000);

  it.each(['export.zip', 'notes.md'])(
    'keeps the default to PDF and PowerPoint for %s sent with no switch value, as before',
    async (name) => {
      const { jobType } = await send(GIFTED, { name });

      expect(jobType).not.toBe('claude');
      expect(defaultAppliedEvents()).toEqual([]);
    },
    20_000
  );

  it.each(['export.zip', 'notes.md'])(
    'makes Claude cards on the gift from %s when the card switch sent Claude on',
    async (name) => {
      const { jobType, locals } = await send(GIFTED, {
        name,
        body: FROM_SWITCH_ON,
      });

      expect(jobType).toBe('claude');
      expect(locals.aiGift).toBe('only');
    },
    20_000
  );

  it('leaves an Anki deck on its own converter and draws nothing from the gift', async () => {
    const { jobType, locals } = await send(GIFTED, { name: 'deck.apkg' });

    expect(jobType).toBeNull();
    expect(locals.aiGift ?? null).toBeNull();
    expect(defaultAppliedEvents()).toEqual([]);
  }, 20_000);

  it("makes a free account's grant at its first upload the gift pays for, and runs it on the gift", async () => {
    const gifts = new InMemoryAiCreditGiftsRepository();

    const { jobType, locals } = await send(
      { ...GIFTED, gift: storeReaders(gifts) },
      { name: 'lecture.pdf', body: FROM_SWITCH_ON }
    );

    expect(jobType).toBe('claude');
    expect(locals.aiGift).toBe('only');
    expect(gifts.gifts).toEqual([
      expect.objectContaining({
        userId: OWNER,
        credits: 100,
        firstUsedAt: null,
        expiresAt: AI_GIFT_CREDITS_EXPIRE_BY,
      }),
    ]);
    expect(recordedEvents.filter((e) => e.name === 'ai_gift_claimed')).toEqual([
      expect.objectContaining({
        user_id: OWNER,
        props: expect.objectContaining({ trigger: 'upload', gift_id: 1 }),
      }),
    ]);
  }, 20_000);

  it('makes one grant when two first uploads of one account arrive together', async () => {
    const gifts = new InMemoryAiCreditGiftsRepository();
    const account = { ...GIFTED, gift: storeReaders(gifts) };

    const results = await Promise.all([
      send(account, { name: 'a.pdf', body: FROM_SWITCH_ON }),
      send(account, { name: 'b.pdf', body: FROM_SWITCH_ON }),
    ]);

    expect(gifts.gifts).toHaveLength(1);
    expect(results.filter((r) => r.jobType === 'claude')).toHaveLength(1);
  }, 20_000);

  it('makes no grant and keeps the parser once the gift total is full', async () => {
    const gifts = new InMemoryAiCreditGiftsRepository();
    for (let i = 0; i < 80; i += 1) {
      await gifts.startGrant({
        userId: 1000 + i,
        credits: 100,
        startedAt: new Date('2026-11-25T11:00:00.000Z'),
        expiresAt: AI_GIFT_CREDITS_EXPIRE_BY,
        ipHash: null,
      });
    }

    const { jobType } = await send(
      { ...GIFTED, gift: storeReaders(gifts) },
      { name: 'lecture.pdf', body: FROM_SWITCH_ON }
    );

    expect(jobType).toBeNull();
    expect(gifts.gifts).toHaveLength(80);
  }, 20_000);

  it.each<[string, Account, Sent]>([
    [
      'Claude on in the options it sent, without the card switch',
      GIFTED,
      { name: 'lecture.pdf', body: { 'claude-ai-flashcards': 'true' } },
    ],
    [
      'Claude on stored on the account',
      { ...GIFTED, stored: { 'claude-ai-flashcards': 'true' } },
      { name: 'lecture.pdf' },
    ],
    [
      'the switch value sent through MCP',
      { ...GIFTED, locals: { owner: OWNER, mcp_auth: true } },
      { name: 'lecture.pdf', body: FROM_SWITCH_ON },
    ],
    [
      'the switch value sent from the iOS app',
      GIFTED,
      { name: 'lecture.pdf', body: { ...FROM_SWITCH_ON, source: 'app' } },
    ],
  ])(
    'makes no grant for a free account without one, with %s, and keeps the parser as before',
    async (_case, account, file) => {
      const gifts = new InMemoryAiCreditGiftsRepository();

      const { jobType, locals } = await send(
        { ...account, gift: storeReaders(gifts) },
        file
      );

      expect(jobType).not.toBe('claude');
      expect(locals.aiGift ?? null).toBeNull();
      expect(gifts.gifts).toEqual([]);
    },
    20_000
  );

  it.each<[string, Account, Sent]>([
    [
      'MCP',
      { ...GIFTED, locals: { owner: OWNER, mcp_auth: true } },
      { name: 'lecture.pdf', body: { 'claude-ai-flashcards': 'true' } },
    ],
    [
      'the iOS app',
      GIFTED,
      {
        name: 'lecture.pdf',
        body: { 'claude-ai-flashcards': 'true', source: 'app' },
      },
    ],
  ])(
    'runs an existing holder on its gift through %s exactly as before',
    async (_case, account, file) => {
      const { jobType, locals } = await send(account, file);

      expect(jobType).toBe('claude');
      expect(locals.aiGift).toBe('only');
    },
    20_000
  );

  it.each<[string, Account]>([
    [
      'the account recorded turning AI off',
      {
        ...GIFTED,
        stored: {
          'claude-ai-flashcards': 'false',
          [AI_CHOICE_AT_KEY]: '1762300000',
        },
      },
    ],
    [
      'the latest AI toggle the account made was off',
      {
        ...GIFTED,
        stored: { 'claude-ai-flashcards': 'false' },
        latestToggle: 'upload_ai_turned_off',
      },
    ],
    [
      'the gift expired',
      {
        ...GIFTED,
        gift: giftReaders({
          grant: { ...grant, expiresAt: new Date('2026-11-25T11:00:00.000Z') },
        }),
      },
    ],
    [
      'the gift is used up',
      { ...GIFTED, gift: giftReaders({ spendUsd: 100 }) },
    ],
    ['the month has fewer than 20 cards left', { ...GIFTED, cardsUsed: 81 }],
    [
      'there is no gift, even while the gift could make one',
      { ...GIFTED, gift: giftReaders({ grant: null }) },
    ],
    [
      'the gift is switched off or has ended',
      { ...GIFTED, gift: giftReaders({ enabled: false }) },
    ],
  ])(
    'keeps the parser and records no default when %s',
    async (_case, account) => {
      const { status, jobType } = await send(account, { name: 'lecture.pdf' });

      expect(status).not.toBe(202);
      expect(jobType).toBeNull();
      expect(defaultAppliedEvents()).toEqual([]);
    },
    20_000
  );

  it('leaves an upload the person sent with Claude on alone, and runs it on the gift', async () => {
    const { jobType, locals } = await send(GIFTED, {
      name: 'lecture.pdf',
      body: {
        'claude-ai-flashcards': 'true',
        [AI_CHOICE_AT_KEY]: '1762300000',
      },
    });

    expect(jobType).toBe('claude');
    expect(defaultAppliedEvents()).toEqual([]);
    expect(locals.aiGift).toBe('only');
  }, 20_000);

  it.each([
    ['a Dropbox pick', '/api/upload/dropbox'],
    ['a Google Drive pick', '/api/upload/google_drive'],
  ])(
    'makes Claude cards on the gift from %s of a PDF, since it is a web upload',
    async (_label, path) => {
      const { jobType, locals } = await send(GIFTED, {
        name: 'lecture.pdf',
        path,
      });

      expect(jobType).toBe('claude');
      expect(locals.aiGift).toBe('only');
      expect(defaultAppliedEvents()).toHaveLength(1);
    },
    20_000
  );

  it("leaves a paying account's zip and markdown exactly as before, on the parser", async () => {
    for (const name of ['export.zip', 'notes.md']) {
      const { jobType } = await send(PAYING, { name });

      expect(jobType).not.toBe('claude');
    }
    expect(defaultAppliedEvents()).toEqual([]);
  }, 20_000);

  it('keeps the parser and records no default while another gift conversion runs', async () => {
    takeGiftMarker(OWNER);

    const { jobType } = await send(GIFTED, { name: 'lecture.pdf' });

    expect(jobType).toBeNull();
    expect(defaultAppliedEvents()).toEqual([]);
  }, 20_000);

  it.each<[string, Account, Sent]>([
    [
      'a PowerPoint sent through MCP',
      { ...GIFTED, locals: { owner: OWNER, mcp_auth: true } },
      { name: 'slides.pptx' },
    ],
    [
      'a PowerPoint sent from the iOS app',
      GIFTED,
      { name: 'slides.pptx', body: { source: 'app' } },
    ],
  ])(
    'leaves %s on the standard parser',
    async (_case, account, file) => {
      const { status, jobType } = await send(account, file);

      expect(status).not.toBe(202);
      expect(jobType).toBeNull();
      expect(defaultAppliedEvents()).toEqual([]);
    },
    20_000
  );
});
