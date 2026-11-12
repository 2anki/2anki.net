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
  const remoteAwareGet: typeof actual.default.get = (service, url, config) => {
    const bytes = remoteFiles.get(url);
    if (bytes != null) {
      return Promise.resolve({ data: bytes } as never);
    }
    return actual.default.get(service, url, config);
  };
  return {
    ...actual,
    default: new Proxy(actual.default, {
      get: (target, property) =>
        property === 'get' ? remoteAwareGet : Reflect.get(target, property),
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

import type { Knex } from 'knex';
import UploadService from './UploadService';
import UploadController from '../controllers/Upload/UploadController';
import NotionService from './NotionService';
import type { INotionRepository } from '../data_layer/NotionRespository';
import { McpToolsService } from './mcp/McpToolsService';
import type AuthenticationService from './AuthenticationService';
import type { UserWithOwner } from './AuthenticationService';
import { InMemoryUserPassRepository } from '../data_layer/UserPassRepository';
import { applyUserLocals } from '../routes/middleware/configureUserLocal';
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

function passHolderLocals() {
  const passes = new InMemoryUserPassRepository();
  passes.seed({
    user_id: OWNER,
    kind: '24h',
    expires_at: new Date(SIGNED_IN_AT.getTime() + 24 * 60 * 60 * 1000),
    stripe_payment_intent_id: 'pi_daypass',
  });
  return signedInLocals(false, passes);
}

function patreonLocals() {
  return signedInLocals(true, new InMemoryUserPassRepository());
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
    ['an active pass', passHolderLocals],
    ['Patreon lifetime access and no subscription', patreonLocals],
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

  it('builds a PowerPoint picked in Dropbox in the background for a paying account', async () => {
    remoteFiles.set(lectureFromDropbox.link, numberedLecture);
    const { service, jobs, settled } = backgroundService();
    const controller = new UploadController(
      service,
      new NotionService({} as INotionRepository)
    );
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

  it("answers a paying MCP caller's PowerPoint link as processing and builds it in the background", async () => {
    remoteFiles.set(lectureLink, numberedLecture);
    const { service, jobs, settled } = backgroundService();
    const tools = new McpToolsService(
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
