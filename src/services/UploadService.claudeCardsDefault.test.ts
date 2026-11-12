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

interface Account {
  locals: Record<string, unknown>;
  stored?: Record<string, string> | null;
  latestToggle?: string | null;
}

const PAYING: Account = { locals: { owner: OWNER, subscriber: true } };
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
      cards_used: 0,
      month_started_at: new Date('2026-11-01T00:00:00Z'),
    }),
    incrementCardUsage: vi.fn().mockResolvedValue(1),
  };
  const service = new UploadService(
    uploads(),
    jobs as unknown as JobRepository,
    users as unknown as UsersRepository,
    ...fakeUploadServiceDeps()
  );
  const buffer = Buffer.from('not a real document');
  const req = {
    files: [
      {
        originalname: file.name,
        mimetype: file.name.endsWith('.pdf')
          ? 'application/pdf'
          : PPTX_MIMETYPE,
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
  return { status, jobType, users };
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
