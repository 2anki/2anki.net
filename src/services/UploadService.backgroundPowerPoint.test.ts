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
import { ASYNC_SLOW_UPLOADS_FLAG } from '../lib/upload/asyncSlowUploads';
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

function inMemoryFlags(
  values: Record<string, boolean>
): IFeatureFlagsRepository {
  return {
    getAll: () => Promise.resolve([]),
    get: (key: string) => Promise.resolve(values[key] ?? null),
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

function payingResponse() {
  let status = 0;
  let body: unknown = null;
  const res = {
    locals: { owner: OWNER, subscriber: true, requestId: 'background-pptx' },
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
  return upload(
    { originalname: 'lecture.pptx', mimetype: PPTX_MIMETYPE, buffer: deck },
    { [ASYNC_SLOW_UPLOADS_FLAG]: true }
  );
}

async function upload(
  file: { originalname: string; mimetype: string; buffer: Buffer },
  flags: Record<string, boolean>,
  body: Record<string, string> = {}
) {
  __setFeatureFlagDependencies({
    repository: inMemoryFlags(flags),
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
  const req = {
    files: [{ ...file, size: file.buffer.length }],
    body,
    headers: {},
    cookies: {},
    path: '/api/upload/file',
  } as unknown as express.Request;
  const { res, status, body: responseBody } = payingResponse();

  await service.handleUpload(req, res);
  const jobId = (responseBody() as { jobId: string }).jobId;
  return { status: status(), jobId, settled, jobs, uploads };
}

describe('a paying account with AI off uploads a PowerPoint while background conversion is on', () => {
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
      null
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
      {},
      { template: 'notionstyle', basic_model_name: 'My Basic' }
    );
    await settled;

    expect(builtSettings[0]).toMatchObject({
      template: 'notionstyle',
      basicModelName: 'My Basic',
    });
  }, 20_000);

  it('falls back to Claude after the parser finds no cards and hands it slide headings as fronts, not slide numbers', async () => {
    const { status, jobId, settled, jobs } = await upload(
      {
        originalname: 'slides.zip',
        mimetype: 'application/zip',
        buffer: Buffer.from(zipSync({ 'lecture.pptx': numberedLecture })),
      },
      {}
    );
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
