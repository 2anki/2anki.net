import { vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type express from 'express';
import { strToU8, zipSync } from 'fflate';

const builtCards = vi.hoisted(() => [] as { name: string; back: string }[]);
const storedKeys = vi.hoisted(() => [] as string[]);
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
      ) as { cards: { name: string; back: string }[] }[];
      builtCards.push(...deckInfo.flatMap((deck) => deck.cards));
      const apkgPath = path.join(this.currentDirectory, 'lecture.apkg');
      fs.writeFileSync(apkgPath, 'apkg');
      return apkgPath;
    }
  },
}));

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

const picture =
  '<p:pic><p:nvPicPr><p:cNvPr id="5" name="Diagram"/></p:nvPicPr></p:pic>';

const chromeOnlyDiagrams = Buffer.from(
  zipSync({
    'ppt/slides/slide1.xml': slide([picture, footer, slideNumber('1')]),
    'ppt/slides/slide2.xml': slide([picture, footer, slideNumber('2')]),
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

async function uploadInBackground(deck: Buffer, body: Record<string, string>) {
  __setFeatureFlagDependencies({
    repository: inMemoryFlags({ [ASYNC_SLOW_UPLOADS_FLAG]: true }),
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
    files: [
      {
        originalname: 'lecture.pptx',
        mimetype:
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        size: deck.length,
        buffer: deck,
      },
    ],
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
    const { status, jobId, settled, jobs, uploads } = await uploadInBackground(
      numberedLecture,
      {}
    );
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

  it.each<{ ai: string; body: Record<string, string> }>([
    {
      ai: 'AI off',
      body: { 'claude-ai-flashcards': 'false', 'process-pdfs': 'false' },
    },
    { ai: 'AI never set', body: { 'process-pdfs': 'false' } },
  ])(
    'stores the cards it stored before chrome detection when a deck whose only text is chrome has slide images off ($ai)',
    async ({ body }) => {
      const { status, jobId, settled, jobs } = await uploadInBackground(
        chromeOnlyDiagrams,
        body
      );
      jobWorkspace = path.join(process.env.WORKSPACE_BASE!, jobId);
      const outcome = await settled;

      expect(status).toBe(202);
      expect(outcome).toBe('stored in My Decks');
      expect(jobs.create).toHaveBeenCalledTimes(1);
      expect(
        builtCards.map((card) => ({
          front: visibleText(card.name),
          back: visibleText(card.back),
        }))
      ).toEqual([
        { front: 'Cell Biology', back: '1' },
        { front: 'Cell Biology', back: '2' },
      ]);
      expect(storedKeys).toHaveLength(1);
    },
    20_000
  );
});
