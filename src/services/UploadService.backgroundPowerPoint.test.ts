import { vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type express from 'express';
import { strToU8, zipSync } from 'fflate';

const builtCards = vi.hoisted(() => [] as { name: string }[]);
const builtSettings = vi.hoisted(() => [] as Record<string, unknown>[]);
const storedKeys = vi.hoisted(() => [] as string[]);
const claudeInputs = vi.hoisted(() => [] as string[]);
const SLIDE_PNG = vi.hoisted(() =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
);

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

vi.mock('../infrastracture/adapters/fileConversion/ConvertPPTToPDF', () => ({
  convertPPTToPDF: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 slides')),
}));

vi.mock(
  '../infrastracture/adapters/fileConversion/convertPDFToImages',
  async (importActual) => {
    const actual =
      await importActual<
        typeof import('../infrastracture/adapters/fileConversion/convertPDFToImages')
      >();
    return {
      ...actual,
      renderPdfPageImages: vi.fn(
        async ({ workspace }: { workspace: { location: string } }) => {
          const pageDir = path.join(workspace.location, 'pdf-lecture');
          fs.mkdirSync(pageDir, { recursive: true });
          const imagePaths = ['page-1.png', 'page-2.png'].map((name) => {
            const imagePath = path.join(pageDir, name);
            fs.writeFileSync(imagePath, SLIDE_PNG);
            return imagePath;
          });
          return { imagePaths, title: 'lecture.pdf' };
        }
      ),
    };
  }
);

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
      ) as { cards: { name: string }[]; settings?: Record<string, unknown> }[];
      builtCards.push(...deckInfo.flatMap((deck) => deck.cards));
      builtSettings.push(...deckInfo.map((deck) => deck.settings ?? {}));
      const apkgPath = path.join(this.currentDirectory, 'lecture.apkg');
      fs.writeFileSync(apkgPath, 'apkg');
      return apkgPath;
    }
  },
}));

vi.mock('../lib/claude/ClaudeService', async (importActual) => {
  const actual =
    await importActual<typeof import('../lib/claude/ClaudeService')>();
  return {
    ...actual,
    generateDeckInfo: vi.fn(async (html: string) => {
      claudeInputs.push(html);
      if (html.includes('REFUSED-BY-CLAUDE')) {
        throw new actual.ClaudeRefusalError();
      }
      return [
        {
          name: 'Cell Biology',
          image: '',
          style: null,
          id: 111222333444555,
          settings: { template: 'specialstyle' },
          cards: [
            {
              name: 'Exocytosis',
              back: 'Ca2+ influx triggers fusion',
              tags: [],
              cloze: false,
              number: 0,
              enableInput: false,
              answer: '',
              media: [],
            },
          ],
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

const remoteFiles = vi.hoisted(() => new Map<string, Buffer>());
const savedDropboxFiles = vi.hoisted(
  () => [] as { owner: number | string; names: string[] }[]
);

vi.mock('./observability/instrumentedAxios', async (importActual) => {
  const actual =
    await importActual<typeof import('./observability/instrumentedAxios')>();
  const registeredGet: typeof actual.default.get = (service, url) => {
    const bytes = remoteFiles.get(url);
    if (bytes == null) {
      return Promise.reject(
        new Error(`unregistered ${service} GET in test: ${url}`)
      );
    }
    return Promise.resolve({ data: bytes } as never);
  };
  return {
    ...actual,
    default: new Proxy(actual.default, {
      get: (target, property) =>
        property === 'get' ? registeredGet : Reflect.get(target, property),
    }),
  };
});

vi.mock('../data_layer/DropboxRepository', async (importActual) => {
  const actual =
    await importActual<typeof import('../data_layer/DropboxRepository')>();
  class RecordingDropboxRepository {
    async saveFiles(files: { name: string }[], owner: number | string) {
      savedDropboxFiles.push({ owner, names: files.map((file) => file.name) });
    }
  }
  return { ...actual, DropboxRepository: RecordingDropboxRepository };
});

vi.mock('../data_layer/GoogleDriveRepository', async (importActual) => {
  const actual =
    await importActual<typeof import('../data_layer/GoogleDriveRepository')>();
  class RecordingGoogleDriveRepository {
    saveFiles() {
      return Promise.resolve();
    }
  }
  return { ...actual, GoogleDriveRepository: RecordingGoogleDriveRepository };
});

import knex, { type Knex } from 'knex';
import UploadService from './UploadService';
import UploadController from '../controllers/Upload/UploadController';
import NotionService from './NotionService';
import type { INotionRepository } from '../data_layer/NotionRespository';
import { McpToolsService } from './mcp/McpToolsService';
import AuthenticationService from './AuthenticationService';
import type { UserWithOwner } from './AuthenticationService';
import {
  InMemoryUserPassRepository,
  type UserPass,
} from '../data_layer/UserPassRepository';
import { applyUserLocals } from '../routes/middleware/configureUserLocal';
import {
  createGoogleDriveDownloadLink,
  createGoogleDriveExportLink,
} from '../controllers/Upload/helpers/createGoogleDriveDownloadLink';
import { ASYNC_PDF_MIN_BYTES } from '../lib/upload/asyncSlowUploads';
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

const NAMESPACES =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

function textShape(placeholder: string, text: string): string {
  return `<p:sp><p:nvSpPr><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function slideNumber(n: string): string {
  return `<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum"><a:t>${n}</a:t></a:fld></a:p></p:txBody></p:sp>`;
}

function slide(shapes: string[]): Uint8Array {
  return strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NAMESPACES}><p:cSld><p:spTree>${shapes.join('')}</p:spTree></p:cSld></p:sld>`
  );
}

const footer = textShape(
  '<p:ph type="ftr" sz="quarter" idx="11"/>',
  'Cell Biology'
);

const numberedLecture = Buffer.from(
  zipSync({
    'ppt/slides/slide1.xml': slide([
      slideNumber('19'),
      textShape('', '03'),
      textShape('', 'Exocytosis'),
      textShape('', 'Ca2+ influx triggers fusion'),
      footer,
    ]),
    'ppt/slides/slide2.xml': slide([
      textShape('<p:ph type="title"/>', 'Mitosis'),
      textShape('<p:ph idx="1"/>', 'Prophase'),
      footer,
      slideNumber('20'),
    ]),
  })
);

const OWNER = 42;

function noFlagsSet(): IFeatureFlagsRepository {
  return {
    getAll: () => Promise.resolve([]),
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(null),
  };
}

function recordingUploads(): IUploadRepository & {
  update: ReturnType<typeof vi.fn>;
} {
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
  let settle!: (outcome: string) => void;
  const settled = new Promise<string>((resolve) => {
    settle = resolve;
  });
  const jobs = {
    create: vi.fn().mockResolvedValue(undefined),
    updateJobStatus: vi.fn(
      async (_id: string, _owner: string, status: string, reason?: string) => {
        if (status === 'failed') settle(`failed: ${reason}`);
      }
    ),
    findJobById: vi.fn().mockResolvedValue({ id: 7 }),
    deleteJob: vi.fn(async () => settle('stored in My Decks')),
  };
  return { jobs, settled };
}

const SUBSCRIBER_LOCALS = { owner: OWNER, subscriber: true };

function responseWith(locals: Record<string, unknown>) {
  let status = 0;
  let body: unknown = null;
  const res = {
    locals: { ...locals, requestId: 'background-pptx' },
    headersSent: false,
    status: vi.fn((code: number) => {
      status = code;
      return res;
    }),
    json: vi.fn((payload: unknown) => {
      body = payload;
      return res;
    }),
    set: vi.fn(() => res),
    send: vi.fn(() => res),
  };
  return {
    res: res as unknown as express.Response,
    status: () => status,
    body: () => body,
  };
}

const ENV: Record<string, string | undefined> = {
  SKIP_CREATE_DECK: undefined,
  SPACES_ENDPOINT: 'https://background-storage.invalid',
  SPACES_DEFAULT_BUCKET_NAME: 'background-bucket',
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

function visibleText(html: string): string {
  return html.replaceAll(/<[^>]+>/g, '').trim();
}

const PPTX_MIMETYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

async function uploadInBackground(deck: Buffer) {
  return upload({
    originalname: 'lecture.pptx',
    mimetype: PPTX_MIMETYPE,
    buffer: deck,
  });
}

type UploadedTestFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

function backgroundService() {
  __setFeatureFlagDependencies({
    repository: noFlagsSet(),
  });
  const uploads = recordingUploads();
  const { jobs, settled } = backgroundJobs();
  const service = new UploadService(
    uploads,
    jobs as unknown as JobRepository,
    {
      getCardOptions: vi.fn().mockResolvedValue(null),
      getCardUsage: vi.fn().mockResolvedValue({
        cards_used: 0,
        month_started_at: new Date('2026-10-01T00:00:00Z'),
      }),
      incrementCardUsage: vi.fn().mockResolvedValue(1),
    } as unknown as UsersRepository,
    ...fakeUploadServiceDeps()
  );
  return { service, jobs, settled, uploads };
}

async function upload(
  file: UploadedTestFile | UploadedTestFile[],
  body: Record<string, string> = {},
  locals: Record<string, unknown> = SUBSCRIBER_LOCALS
) {
  const { service, jobs, settled, uploads } = backgroundService();
  const req = {
    files: (Array.isArray(file) ? file : [file]).map((f) => ({
      ...f,
      size: f.buffer.length,
    })),
    body,
    headers: {},
    cookies: {},
    path: '/api/upload/file',
  } as unknown as express.Request;
  const { res, status, body: responseBody } = responseWith(locals);

  await service.handleUpload(req, res);
  const jobId = (responseBody() as { jobId: string }).jobId;
  return { status: status(), jobId, settled, jobs, uploads };
}

describe('a paying account with AI off uploads a PowerPoint', () => {
  let jobWorkspace: string | null = null;

  beforeAll(() => applyEnv(ENV));

  afterAll(() => applyEnv(originalEnv));

  afterEach(() => {
    __resetFeatureFlagModuleForTests();
    builtCards.length = 0;
    storedKeys.length = 0;
    if (jobWorkspace != null) {
      fs.rmSync(jobWorkspace, { recursive: true, force: true });
      jobWorkspace = null;
    }
  });

  it('builds the deck in the background job with slide headings as fronts, not slide numbers', async () => {
    const { status, jobId, settled, jobs, uploads } =
      await uploadInBackground(numberedLecture);
    jobWorkspace = path.join(process.env.WORKSPACE_BASE!, jobId);
    const outcome = await settled;

    expect(status).toBe(202);
    expect(jobs.create).toHaveBeenCalledWith(
      jobId,
      String(OWNER),
      'lecture.pptx',
      'upload'
    );
    expect(outcome).toBe('stored in My Decks');
    expect(builtCards.map((card) => visibleText(card.name))).toEqual([
      'Exocytosis',
      'Mitosis',
    ]);
    expect(storedKeys).toHaveLength(1);
    expect(uploads.update).toHaveBeenCalledWith(
      OWNER,
      'lecture.apkg',
      storedKeys[0],
      expect.any(Number),
      null,
      { skippedAiFiles: [] }
    );
  }, 20_000);
});

describe('a paying account with AI never set uploads a zip holding only a PowerPoint', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  let workspaceBase: string;

  beforeAll(() => applyEnv(ENV));

  afterAll(() => applyEnv(originalEnv));

  beforeEach(() => {
    workspaceBase = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-pptx-'));
    process.env.WORKSPACE_BASE = workspaceBase;
  });

  afterEach(() => {
    __resetFeatureFlagModuleForTests();
    builtCards.length = 0;
    storedKeys.length = 0;
    claudeInputs.length = 0;
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
    fs.rmSync(workspaceBase, { recursive: true, force: true });
  });

  function cardFronts(html: string): string[] {
    return [...html.matchAll(/<summary>(.*?)<\/summary>/gs)].map(
      (match) => match[1]
    );
  }

  it("builds the Claude fallback deck with the user's template and note types", async () => {
    builtSettings.length = 0;
    const { settled } = await upload(
      {
        originalname: 'slides.zip',
        mimetype: 'application/zip',
        buffer: Buffer.from(zipSync({ 'lecture.pptx': numberedLecture })),
      },
      { template: 'notionstyle', basic_model_name: 'My Basic' }
    );
    await settled;

    expect(builtSettings[0]).toMatchObject({
      template: 'notionstyle',
      basicModelName: 'My Basic',
    });
  }, 20_000);

  it('falls back to Claude after the parser finds no cards and hands it slide headings as fronts, not slide numbers', async () => {
    const { status, jobId, settled, jobs } = await upload({
      originalname: 'slides.zip',
      mimetype: 'application/zip',
      buffer: Buffer.from(zipSync({ 'lecture.pptx': numberedLecture })),
    });
    const outcome = await settled;

    expect(status).toBe(202);
    expect(jobs.create).toHaveBeenCalledWith(
      jobId,
      String(OWNER),
      expect.any(String),
      'claude'
    );
    expect(outcome).toBe('stored in My Decks');
    expect(claudeInputs).toHaveLength(1);
    expect(cardFronts(claudeInputs[0])).toEqual(['Exocytosis', 'Mitosis']);
  }, 20_000);
});

describe('a paying account with AI on uploads a zip where Claude declines one file', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  let workspaceBase: string;

  beforeAll(() => applyEnv(ENV));

  afterAll(() => applyEnv(originalEnv));

  beforeEach(() => {
    workspaceBase = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-skip-'));
    process.env.WORKSPACE_BASE = workspaceBase;
  });

  afterEach(() => {
    __resetFeatureFlagModuleForTests();
    builtCards.length = 0;
    storedKeys.length = 0;
    claudeInputs.length = 0;
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
    fs.rmSync(workspaceBase, { recursive: true, force: true });
  });

  const declinedFileLater = {
    'cells.md': strToU8('# Cells\n\nExocytosis needs calcium.\n'),
    'week 3.md': strToU8('# Week 3\n\nREFUSED-BY-CLAUDE\n'),
  };

  it('stores the other file in My Decks with the declined file named', async () => {
    const { status, settled, uploads } = await upload(
      {
        originalname: 'notes.zip',
        mimetype: 'application/zip',
        buffer: Buffer.from(zipSync(declinedFileLater)),
      },
      { 'claude-ai-flashcards': 'true' }
    );
    const outcome = await settled;

    expect(status).toBe(202);
    expect(outcome).toBe('stored in My Decks');
    expect(builtCards.map((card) => visibleText(card.name))).toEqual([
      'Exocytosis',
    ]);
    expect(uploads.update).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      storedKeys[0],
      expect.any(Number),
      null,
      { skippedAiFiles: [{ name: 'week 3.md', reason: 'declined' }] }
    );
  }, 20_000);

  it('names the declined file when the two files are uploaded separately', async () => {
    const { status, settled, uploads } = await upload(
      Object.entries(declinedFileLater).map(([name, bytes]) => ({
        originalname: name,
        mimetype: 'text/markdown',
        buffer: Buffer.from(bytes),
      })),
      { 'claude-ai-flashcards': 'true' }
    );
    const outcome = await settled;

    expect(status).toBe(202);
    expect(outcome).toBe('stored in My Decks');
    expect(uploads.update).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      storedKeys[0],
      expect.any(Number),
      null,
      { skippedAiFiles: [{ name: 'week 3.md', reason: 'declined' }] }
    );
  }, 20_000);

  it('names the declined file when AI was never set and the parser found no cards', async () => {
    const { status, settled, uploads, jobs } = await upload({
      originalname: 'notes.zip',
      mimetype: 'application/zip',
      buffer: Buffer.from(
        zipSync({
          'lecture.pptx': numberedLecture,
          'week 3.md': strToU8('REFUSED-BY-CLAUDE\n'),
        })
      ),
    });
    const outcome = await settled;

    expect(status).toBe(202);
    expect(jobs.create).toHaveBeenCalledWith(
      expect.any(String),
      String(OWNER),
      expect.any(String),
      'claude'
    );
    expect(outcome).toBe('stored in My Decks');
    expect(uploads.update).toHaveBeenCalledWith(
      OWNER,
      expect.any(String),
      storedKeys[0],
      expect.any(Number),
      null,
      { skippedAiFiles: [{ name: 'week 3.md', reason: 'declined' }] }
    );
  }, 20_000);
});

const SIGNED_IN_AT = new Date('2026-11-12T12:00:00Z');

async function signedInLocals(
  patreon: boolean,
  passes: InMemoryUserPassRepository
): Promise<Record<string, unknown>> {
  const res = { locals: {} } as express.Response;
  await applyUserLocals(
    res,
    {
      owner: OWNER,
      email: 'learner@example.com',
      patreon,
      chat_consent_at: null,
    } as unknown as UserWithOwner,
    {
      getIsSubscriber: async () => false,
      getSubscriptionInfo: async () => null,
    } as unknown as AuthenticationService,
    {} as Knex,
    SIGNED_IN_AT,
    passes
  );
  return res.locals;
}

function passHolderLocals(
  pass: Pick<UserPass, 'kind' | 'stripe_payment_intent_id'>
) {
  const passes = new InMemoryUserPassRepository();
  passes.seed({
    ...pass,
    user_id: OWNER,
    expires_at: new Date(SIGNED_IN_AT.getTime() + 24 * 60 * 60 * 1000),
  });
  return signedInLocals(false, passes);
}

const STRIPE_DAY_PASS = {
  kind: '24h',
  stripe_payment_intent_id: 'pi_daypass',
} as const;

const APPLE_PASS = {
  kind: 'unlimited',
  stripe_payment_intent_id: 'apple:2000000000000001',
} as const;

function patreonLocals() {
  return signedInLocals(true, new InMemoryUserPassRepository());
}

const AUTO_SYNC_PRODUCT = 'prod_auto_sync';

async function autoSyncSubscriberLocals(): Promise<Record<string, unknown>> {
  const database = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await database.schema.createTable('subscriptions', (table) => {
    table.increments('id').primary();
    table.text('email').nullable();
    table.text('linked_email').nullable();
    table.boolean('active').notNullable().defaultTo(false);
    table.text('stripe_product_id').nullable();
  });
  await database('subscriptions').insert({
    email: 'learner@example.com',
    linked_email: 'learner@example.com',
    active: true,
    stripe_product_id: AUTO_SYNC_PRODUCT,
  });
  const res = { locals: {} } as express.Response;
  await applyUserLocals(
    res,
    {
      owner: OWNER,
      email: 'learner@example.com',
      patreon: false,
      chat_consent_at: null,
    } as unknown as UserWithOwner,
    new AuthenticationService({} as never, {} as never),
    database,
    SIGNED_IN_AT,
    new InMemoryUserPassRepository()
  );
  await database.destroy();
  return res.locals;
}

const lectureFromDropbox = {
  bytes: numberedLecture.length,
  icon: '',
  id: 'id:lecture-slides',
  isDir: false,
  link: 'https://dl.dropboxusercontent.com/s/lecture.pptx',
  linkType: 'direct',
  name: 'lecture.pptx',
};

const lectureLink = 'https://slides.example/lecture.pptx';

const largePdf = Buffer.concat([
  Buffer.from('%PDF-1.4 textbook\n'),
  Buffer.alloc(ASYNC_PDF_MIN_BYTES),
]);

type LargePdfSent = { answer: Record<string, unknown>; jobId: string };

function mcpTools(service: UploadService) {
  return new McpToolsService(
    { getJobsByOwner: async () => [] },
    {} as never,
    {} as never,
    (req, res) => service.handleUpload(req, res),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { holdForPlan: async () => null },
    'https://mcp.test'
  );
}

function uploadController(service: UploadService) {
  return new UploadController(
    service,
    new NotionService({} as INotionRepository)
  );
}

async function largePdfFromDropbox(
  service: UploadService
): Promise<LargePdfSent> {
  const picked = {
    ...lectureFromDropbox,
    bytes: largePdf.length,
    id: 'id:textbook',
    link: 'https://dl.dropboxusercontent.com/s/textbook.pdf',
    name: 'textbook.pdf',
  };
  remoteFiles.set(picked.link, largePdf);
  const { res, status, body } = responseWith(SUBSCRIBER_LOCALS);
  const req = {
    body: { files: JSON.stringify([picked]) },
    headers: {},
    cookies: {},
    path: '/api/upload/dropbox',
  } as unknown as express.Request;

  await uploadController(service).dropbox(req, res);
  await vi.waitFor(() => expect(status()).not.toBe(0), { timeout: 10_000 });
  return {
    answer: { status: status() },
    jobId: (body() as { jobId: string }).jobId,
  };
}

async function largePdfFromDrive(
  service: UploadService
): Promise<LargePdfSent> {
  const picked = {
    id: 'textbook-file-id',
    name: 'textbook.pdf',
    mimeType: 'application/pdf',
    iconUrl: '',
    url: '',
    sizeBytes: 1024,
    embedUrl: '',
    description: '',
    driveSuccess: true,
    isShared: false,
    lastEditedUtc: 0,
    serviceId: '',
    type: 'document',
  };
  remoteFiles.set(createGoogleDriveDownloadLink(picked as never), largePdf);
  const { res, status, body } = responseWith(SUBSCRIBER_LOCALS);
  const req = {
    body: {
      files: JSON.stringify([picked]),
      googleDriveAuth: 'drive-access-token',
    },
    headers: {},
    cookies: {},
    path: '/api/upload/google_drive',
  } as unknown as express.Request;

  await uploadController(service).googleDrive(req, res);
  await vi.waitFor(() => expect(status()).not.toBe(0), { timeout: 10_000 });
  return {
    answer: { status: status() },
    jobId: (body() as { jobId: string }).jobId,
  };
}

async function largePdfFromMcp(service: UploadService): Promise<LargePdfSent> {
  const link = 'https://books.example/textbook.pdf';
  remoteFiles.set(link, largePdf);
  const tools = mcpTools(service);

  const result = (await tools.convertToDeck(
    { url: link },
    String(OWNER),
    SUBSCRIBER_LOCALS
  )) as { kind: string; jobId: string };
  return { answer: { kind: result.kind }, jobId: result.jobId };
}

describe('a PowerPoint reaching the background path from another entry point', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  let workspaceBase: string;

  beforeAll(() => applyEnv(ENV));

  afterAll(() => applyEnv(originalEnv));

  beforeEach(() => {
    workspaceBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-entry-'));
    process.env.WORKSPACE_BASE = workspaceBase;
  });

  afterEach(() => {
    __resetFeatureFlagModuleForTests();
    builtCards.length = 0;
    storedKeys.length = 0;
    savedDropboxFiles.length = 0;
    remoteFiles.clear();
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
    fs.rmSync(workspaceBase, { recursive: true, force: true });
  });

  it.each([
    ['an active Stripe pass', () => passHolderLocals(STRIPE_DAY_PASS)],
    ['an active Apple in-app pass', () => passHolderLocals(APPLE_PASS)],
    ['Patreon lifetime access and no subscription', patreonLocals],
    ['an active Auto Sync subscription', autoSyncSubscriberLocals],
  ])(
    'builds the deck in the background for a signed-in account with %s',
    async (_account, buildLocals) => {
      const locals = await buildLocals();
      const { status, jobId, settled, jobs } = await upload(
        {
          originalname: 'lecture.pptx',
          mimetype: PPTX_MIMETYPE,
          buffer: numberedLecture,
        },
        {},
        locals
      );
      const outcome = await settled;

      expect(status).toBe(202);
      expect(jobs.create).toHaveBeenCalledWith(
        jobId,
        String(OWNER),
        'lecture.pptx',
        'upload'
      );
      expect(outcome).toBe('stored in My Decks');
    },
    20_000
  );

  it('builds a PowerPoint from the iOS app in the background for a paying subscriber', async () => {
    const { status, jobId, settled, jobs } = await upload(
      {
        originalname: 'lecture.pptx',
        mimetype: PPTX_MIMETYPE,
        buffer: numberedLecture,
      },
      { source: 'app' }
    );
    const outcome = await settled;

    expect(status).toBe(202);
    expect(jobs.create).toHaveBeenCalledWith(
      jobId,
      String(OWNER),
      'lecture.pptx',
      'upload'
    );
    expect(outcome).toBe('stored in My Decks');
  }, 20_000);

  it('starts a background job when an MCP caller sends text named as a PowerPoint', async () => {
    const { service, jobs, settled } = backgroundService();
    const tools = mcpTools(service);

    const result = (await tools.convertToDeck(
      {
        text: 'Exocytosis\nCa2+ influx triggers fusion',
        filename: 'lecture.pptx',
      },
      String(OWNER),
      SUBSCRIBER_LOCALS
    )) as { kind: string; jobId: string };
    await settled;

    expect(result.kind).toBe('processing');
    expect(jobs.create).toHaveBeenCalledWith(
      result.jobId,
      String(OWNER),
      'lecture.pptx',
      'upload'
    );
  }, 20_000);

  it('builds a PowerPoint picked in Dropbox in the background for a paying account', async () => {
    remoteFiles.set(lectureFromDropbox.link, numberedLecture);
    const { service, jobs, settled } = backgroundService();
    const controller = uploadController(service);
    const { res, status, body } = responseWith(SUBSCRIBER_LOCALS);
    const req = {
      body: { files: JSON.stringify([lectureFromDropbox]) },
      headers: {},
      cookies: {},
      path: '/api/upload/dropbox',
    } as unknown as express.Request;

    await controller.dropbox(req, res);
    const outcome = await settled;

    expect(status()).toBe(202);
    expect(jobs.create).toHaveBeenCalledWith(
      (body() as { jobId: string }).jobId,
      String(OWNER),
      'lecture.pptx',
      'upload'
    );
    expect(outcome).toBe('stored in My Decks');
    expect(savedDropboxFiles).toEqual([
      { owner: OWNER, names: ['lecture.pptx'] },
    ]);
  }, 20_000);

  it.each([
    ['Dropbox', largePdfFromDropbox, { status: 202 }],
    ['Google Drive', largePdfFromDrive, { status: 202 }],
    ['an MCP link', largePdfFromMcp, { kind: 'processing' }],
  ])(
    'sends a large PDF from %s, which carries no PDF answer, to the background for a paying account',
    async (_entryPoint, send, expectedAnswer) => {
      const { service, jobs, settled } = backgroundService();

      const { answer, jobId } = await send(service);
      await settled;

      expect(answer).toEqual(expectedAnswer);
      expect(jobs.create).toHaveBeenCalledWith(
        jobId,
        String(OWNER),
        'textbook.pdf',
        'upload'
      );
    },
    20_000
  );

  it('builds Google Slides picked in Drive in the background for a paying account', async () => {
    const slidesFromDrive = {
      id: 'slides-file-id',
      name: 'lecture',
      mimeType: 'application/vnd.google-apps.presentation',
      iconUrl: '',
      url: '',
      sizeBytes: numberedLecture.length,
      embedUrl: '',
      description: '',
      driveSuccess: true,
      isShared: false,
      lastEditedUtc: 0,
      serviceId: '',
      type: 'presentation',
    };
    remoteFiles.set(
      createGoogleDriveExportLink(
        slidesFromDrive as never,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ),
      numberedLecture
    );
    const { service, jobs, settled } = backgroundService();
    const controller = uploadController(service);
    const { res, status, body } = responseWith(SUBSCRIBER_LOCALS);
    const req = {
      body: {
        files: JSON.stringify([slidesFromDrive]),
        googleDriveAuth: 'drive-access-token',
      },
      headers: {},
      cookies: {},
      path: '/api/upload/google_drive',
    } as unknown as express.Request;

    await controller.googleDrive(req, res);
    const outcome = await settled;

    expect(status()).toBe(202);
    expect(jobs.create).toHaveBeenCalledWith(
      (body() as { jobId: string }).jobId,
      String(OWNER),
      'lecture.pptx',
      'upload'
    );
    expect(outcome).toBe('stored in My Decks');
  }, 20_000);

  it("answers a paying MCP caller's PowerPoint link as processing and builds it in the background", async () => {
    remoteFiles.set(lectureLink, numberedLecture);
    const { service, jobs, settled } = backgroundService();
    const tools = mcpTools(service);

    const result = await tools.convertToDeck(
      { url: lectureLink },
      String(OWNER),
      SUBSCRIBER_LOCALS
    );
    const outcome = await settled;

    expect(result).toMatchObject({ kind: 'processing' });
    expect(jobs.create).toHaveBeenCalledWith(
      (result as { jobId: string }).jobId,
      String(OWNER),
      'lecture.pptx',
      'upload'
    );
    expect(outcome).toBe('stored in My Decks');
  }, 20_000);
});
