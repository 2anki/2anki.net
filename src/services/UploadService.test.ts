import { vi, type Mock, type MockedClass, type MockInstance } from 'vitest';
import os from 'os';
import fs from 'node:fs';
import path from 'path';
import express from 'express';
import knex, { Knex } from 'knex';

vi.mock('../usecases/uploads/GeneratePackagesUseCase', () => {
  return {
    __esModule: true,
    default: vi.fn(),
  };
});

const mockGenerateDeckInfo = vi.fn();
vi.mock('../lib/claude/ClaudeService', async () => ({
  ...(await vi.importActual<typeof import('../lib/claude/ClaudeService')>(
    '../lib/claude/ClaudeService'
  )),
  generateDeckInfo: (...args: unknown[]) => mockGenerateDeckInfo(...args),
}));

const mockGenerateAiPreview = vi.fn();
vi.mock('../lib/claude/aiPreview', async () => ({
  ...(await vi.importActual<typeof import('../lib/claude/aiPreview')>(
    '../lib/claude/aiPreview'
  )),
  generateAiPreview: (...args: unknown[]) => mockGenerateAiPreview(...args),
}));

vi.mock('../lib/integrations/stripe', () => ({
  getStripe: vi.fn().mockReturnValue({
    customers: { retrieve: vi.fn() },
  }),
  updateStoreSubscription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/SubscriptionService', () => ({
  __esModule: true,
  default: { findActiveStripeSubscriptions: vi.fn().mockResolvedValue([]) },
}));

vi.mock('./events/track', () => ({ track: vi.fn() }));

const mockGetFeatureFlag = vi.fn().mockResolvedValue(false);
vi.mock('../lib/featureFlags/getFeatureFlag', () => ({
  getFeatureFlag: (...args: unknown[]) => mockGetFeatureFlag(...args),
}));

let mockWorkspaceLocation = '';
let mockWorkspaceId = 'test-ws-id';
let mockFirstApkg: Buffer | null = null;
vi.mock('../lib/parser/WorkSpace', () => {
  return {
    __esModule: true,
    default: vi.fn().mockImplementation(function () {
      return {
        get id() {
          return mockWorkspaceId;
        },
        get location() {
          return mockWorkspaceLocation;
        },
        getFirstAPKG: () => Promise.resolve(mockFirstApkg),
      };
    }),
  };
});

vi.mock('../lib/parser/exporters/CustomExporter', () => ({
  __esModule: true,
  default: vi.fn().mockImplementation(function () {
    return {
      configure: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

const mockStorageDelete = vi.fn().mockResolvedValue(true);
const mockStorageUploadFile = vi.fn().mockResolvedValue(undefined);
const mockStorageUniqify = vi.fn().mockReturnValue('test-key.apkg');
vi.mock('../lib/storage/StorageHandler', () => {
  return {
    __esModule: true,
    default: vi.fn().mockImplementation(function () {
      return {
        delete: mockStorageDelete,
        uploadFile: mockStorageUploadFile,
        uniqify: mockStorageUniqify,
      };
    }),
  };
});

import GeneratePackagesUseCase from '../usecases/uploads/GeneratePackagesUseCase';
import { writePdfImageFallbackMarker } from '../infrastracture/adapters/fileConversion/pdfImageFallbackMarker';
import type { PhotoToFlashcardsUseCase } from '../usecases/imageOcclusion/PhotoToFlashcardsUseCase';
import { EmptyDeckError } from '../usecases/jobs/EmptyDeckError';
import { UploadFileUnavailableError } from '../usecases/uploads/UploadFileUnavailableError';
import { buildPdfFallbackChoiceSentinel } from '../lib/pdf/pdfFallbackChoice';
import {
  createWorkerTerminationError,
  WORKER_INTERRUPTED_REASON,
} from '../lib/workerTermination';
import { AiCreditsExhaustedError } from '../lib/claude/aiSpendGuard';
import { DeckTooLargeError } from '../lib/parser/exporters/DeckTooLargeError';
import CustomExporter from '../lib/parser/exporters/CustomExporter';
import UploadService, {
  resolveUploadWarning,
  walkMediaFiles,
} from './UploadService';
import { anonRecoveryKey } from '../lib/upload/anonymousRecovery';
import { ANONYMOUS_AI_PREVIEW_FLAG } from '../lib/upload/anonymousAiPreview';
import {
  AiCreditsTrippedWithSalvage,
  DeckInfo,
  EMPTY_CONTENT_UPLOAD_MESSAGE,
} from '../lib/claude/ClaudeService';
import { track } from './events/track';

const trackMock = track as Mock;
import { IUploadRepository } from '../data_layer/UploadRespository';
import JobRepository from '../data_layer/JobRepository';
import UsersRepository from '../data_layer/UsersRepository';
import { ISettingsRepository } from '../data_layer/SettingsRepository';
import Uploads from '../data_layer/public/Uploads';
import { fakeUploadServiceDeps } from '../test/fakes/uploadServiceDeps';
import { combineSlidesIntoHTML } from '../lib/pdf/combineSlidesIntoHTML';
import type { SlideUnit } from '../lib/parser/sourceUnits/extractPptxSourceUnits';
import type { IssuedCardGuid } from '../lib/anki/guidLedgerTypes';
import { InMemoryHeldDeckRepository } from '../data_layer/HeldDeckRepository';
import { planHoldKey } from '../usecases/uploads/ClaimHeldDeckUseCase';
import { InMemoryRateLimiter } from '../lib/rateLimit/InMemoryRateLimiter';
import {
  ANONYMOUS_CARD_CAP,
  MONTHLY_CARD_LIMIT,
  MonthlyLimitError,
} from '../usecases/users/CheckMonthlyCardLimitUseCase';

const MockGeneratePackagesUseCase = GeneratePackagesUseCase as MockedClass<
  typeof GeneratePackagesUseCase
>;

beforeEach(() => {
  mockGetFeatureFlag.mockClear();
  mockGetFeatureFlag.mockResolvedValue(false);
});

function buildRepository(): IUploadRepository {
  return {
    deleteUpload: (_owner: number, _key: string) => Promise.resolve(1),
    getUploadsByOwner: (_owner: number) => Promise.resolve([] as Uploads[]),
    findByIdAndOwner: (_id: number, _owner: number) => Promise.resolve(null),
    findByObjectId: (_objectId: string) => Promise.resolve(null),
    findByKey: (_owner: number, _key: string) => Promise.resolve(null),
    findAllByObjectIdAndOwner: (_objectId: string, _owner: number) =>
      Promise.resolve([] as Uploads[]),
    update: (
      _owner: number,
      _filename: string,
      _key: string,
      _size_mb: number,
      _source?: string | null
    ) => Promise.resolve([] as Uploads[]),
    getLastUploadForUser: (_userId: number) => Promise.resolve(null),
    getLastReconvertibleUpload: (_userId: number) => Promise.resolve(null),
    findByOwnerAndDedupeKey: (_owner: number, _dedupeKey: string) =>
      Promise.resolve(null),
    insertNativeDeck: () =>
      Promise.reject(new Error('not implemented')) as Promise<Uploads>,
    insertConvertedDeck: () =>
      Promise.reject(new Error('not implemented')) as Promise<Uploads>,
  };
}

function buildUsersRepo(
  overrides: Partial<UsersRepository> = {}
): UsersRepository {
  return {
    getCardUsage: vi
      .fn()
      .mockResolvedValue({ cards_used: 0, month_started_at: new Date() }),
    incrementCardUsage: vi.fn().mockResolvedValue(1),
    getCardOptions: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as UsersRepository;
}

function buildRequest(
  overrides: Partial<express.Request> = {}
): express.Request {
  return {
    files: [
      {
        originalname: 'study-notes.zip',
        mimetype: 'application/zip',
        size: 1024,
        path: '/tmp/study-notes.zip',
      },
    ],
    body: {},
    path: '/api/upload/file',
    ...overrides,
  } as unknown as express.Request;
}

function buildResponse(): {
  res: express.Response;
  capturedStatus: () => number;
  capturedJson: () => unknown;
  capturedSend: () => unknown;
} {
  let status = 0;
  let json: unknown = null;
  let sent: unknown = null;

  const jsonFn = vi.fn((body: unknown) => {
    json = body;
    return res; // eslint-disable-line @typescript-eslint/no-use-before-define
  });
  const statusFn = vi.fn((code: number) => {
    status = code;
    return res; // eslint-disable-line @typescript-eslint/no-use-before-define
  });
  const setFn = vi.fn(() => res); // eslint-disable-line @typescript-eslint/no-use-before-define
  const sendFn = vi.fn((body: unknown) => {
    sent = body;
    return res; // eslint-disable-line @typescript-eslint/no-use-before-define
  });
  const contentTypeFn = vi.fn(() => res); // eslint-disable-line @typescript-eslint/no-use-before-define
  const attachmentFn = vi.fn(() => res); // eslint-disable-line @typescript-eslint/no-use-before-define
  const redirectFn = vi.fn(() => res); // eslint-disable-line @typescript-eslint/no-use-before-define

  const res = {
    status: statusFn,
    json: jsonFn,
    set: setFn,
    send: sendFn,
    contentType: contentTypeFn,
    attachment: attachmentFn,
    redirect: redirectFn,
    locals: {},
    headersSent: false,
  } as unknown as express.Response;

  return {
    res,
    capturedStatus: () => status,
    capturedJson: () => json,
    capturedSend: () => sent,
  };
}

describe('UploadService.handleUpload — error paths', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    trackMock.mockClear();
    mockGenerateAiPreview.mockReset();
    mockGetFeatureFlag.mockResolvedValue(false);
  });

  function anonAiMarkdownRequest(anonId: string): express.Request {
    return buildRequest({
      files: [
        {
          originalname: 'notes.md',
          mimetype: 'text/markdown',
          size: 20,
          buffer: Buffer.from('# Heading\n\nSome notes to study'),
        },
      ],
      body: { 'claude-ai-flashcards': 'true' },
      cookies: { anon_id: anonId },
    } as unknown as Partial<express.Request>);
  }

  it('does not run the AI preview for an anonymous AI upload when the flag is off', async () => {
    const executeMock = vi.fn().mockResolvedValue({ packages: [] });
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return { execute: executeMock } as unknown as InstanceType<
        typeof GeneratePackagesUseCase
      >;
    });
    mockGetFeatureFlag.mockResolvedValue(false);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(anonAiMarkdownRequest('visitor-off'), res);

    // Today's behaviour: the standard sync path runs, no AI preview is made.
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(mockGenerateAiPreview).not.toHaveBeenCalled();
    expect(capturedJson()).not.toMatchObject({ kind: 'ai_preview' });
  });

  it('returns an AI preview for an anonymous AI upload when the flag is on', async () => {
    const executeMock = vi.fn().mockResolvedValue({ packages: [] });
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return { execute: executeMock } as unknown as InstanceType<
        typeof GeneratePackagesUseCase
      >;
    });
    mockGetFeatureFlag.mockResolvedValue(true);
    mockGenerateAiPreview.mockResolvedValue([{ front: 'q', back: 'a' }]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(anonAiMarkdownRequest('visitor-on'), res);

    expect(mockGenerateAiPreview).toHaveBeenCalledTimes(1);
    expect(capturedJson()).toMatchObject({
      kind: 'ai_preview',
      cards: [{ front: 'q', back: 'a' }],
    });
    // The preview short-circuits the sync/parser path.
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('does not run the AI preview when the request carries a pass token that did not validate', async () => {
    const executeMock = vi.fn().mockResolvedValue({ packages: [] });
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return { execute: executeMock } as unknown as InstanceType<
        typeof GeneratePackagesUseCase
      >;
    });
    mockGetFeatureFlag.mockResolvedValue(true);
    mockGenerateAiPreview.mockResolvedValue([{ front: 'q', back: 'a' }]);
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = anonAiMarkdownRequest('visitor-stale-pass');
    (req as unknown as { headers: Record<string, string> }).headers = {
      'x-pass-token': 'cs_expired',
    };
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(mockGenerateAiPreview).not.toHaveBeenCalled();
    expect(capturedJson()).not.toMatchObject({ kind: 'ai_preview' });
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('emits upload_started and conversion_failed sharing the anonymous_id from the cookie', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      cookies: { anon_id: 'anon-upload-1' },
    } as Partial<express.Request>);
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(trackMock).toHaveBeenCalledWith(
      'upload_started',
      expect.objectContaining({ anonymousId: 'anon-upload-1', userId: null })
    );
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        anonymousId: 'anon-upload-1',
        props: expect.objectContaining({ reason: 'empty_deck' }),
      })
    );
  });

  it('hands the request id to the package generator so Claude spend lines can be joined back', async () => {
    const executeMock = vi.fn().mockResolvedValue({ packages: [] });
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return { execute: executeMock } as unknown as InstanceType<
        typeof GeneratePackagesUseCase
      >;
    });
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res } = buildResponse();
    res.locals.owner = 42;
    res.locals.requestId = '0f1e2d3c-4b5a-4697-8877-665544332211';

    await service.handleUpload(req, res);

    expect(executeMock).toHaveBeenCalledTimes(1);
    const [, , , , , ownerId, context] = executeMock.mock.calls[0];
    expect(ownerId).toBe(42);
    expect(context).toMatchObject({
      requestId: '0f1e2d3c-4b5a-4697-8877-665544332211',
    });
  });

  it('attaches the saved custom templates for a signed-in upload before generating packages', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const attachCustomTemplates = vi.fn().mockResolvedValue(undefined);
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({
        settings: { attachCustomTemplates } as unknown as ISettingsRepository,
      })
    );
    const req = buildRequest({
      body: { template: 'custom' },
    } as Partial<express.Request>);
    const { res } = buildResponse();
    res.locals.owner = 42;

    await service.handleUpload(req, res);

    expect(attachCustomTemplates).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ template: 'custom' })
    );
  });

  it('does not look up templates for anonymous uploads', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const attachCustomTemplates = vi.fn().mockResolvedValue(undefined);
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({
        settings: { attachCustomTemplates } as unknown as ISettingsRepository,
      })
    );
    const req = buildRequest({
      body: { template: 'custom' },
    } as Partial<express.Request>);
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(attachCustomTemplates).not.toHaveBeenCalled();
  });

  it('attributes source=dropbox when the request lands on the dropbox path with no explicit source', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      path: '/api/upload/dropbox',
    } as Partial<express.Request>);
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(trackMock).toHaveBeenCalledWith(
      'upload_started',
      expect.objectContaining({
        props: expect.objectContaining({ source: 'dropbox' }),
      })
    );
  });

  it('returns 400 JSON with empty_export code, spec copy and docs link when no packages are produced', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    const body = capturedJson() as {
      code: string;
      message: string;
      filename: string;
      docsLink: string;
    };
    expect(body.code).toBe('empty_export');
    expect(typeof body.message).toBe('string');
    expect(body.message).not.toMatch(/rules/i);
    expect(body.message).not.toMatch(/valid toggle/i);
    expect(body.message).not.toMatch(/<[a-z]/i);
    expect(body.message).toBe(
      'No cards were found in this file. Most files need a toggle-list (Notion) or a question/answer pair to become cards. See common problems for the formats that work.'
    );
    expect(body.filename).toBe('study-notes.zip');
    expect(body.docsLink).toBe('/documentation/help/common-problems');
  });

  it('carries the worker empty_reason onto conversion_failed and the 400 body', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi
          .fn()
          .mockResolvedValue({ packages: [], emptyReason: 'all_filtered' }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      cookies: { anon_id: 'anon-filtered' },
    } as Partial<express.Request>);
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({
          reason: 'empty_deck',
          empty_reason: 'all_filtered',
        }),
      })
    );
    const body = capturedJson() as { empty_reason: string };
    expect(body.empty_reason).toBe('all_filtered');
  });

  it('falls back to unknown empty_reason when the worker classified nothing', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({
          reason: 'empty_deck',
          empty_reason: 'unknown',
        }),
      })
    );
    const body = capturedJson() as { empty_reason: string };
    expect(body.empty_reason).toBe('unknown');
  });

  it('returns image_only_no_text with a Photo to Deck link when an image-only upload yields 0 cards', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [
        {
          originalname: 'lecture-page.png',
          mimetype: 'image/png',
          size: 2048,
          path: '/tmp/lecture-page.png',
        } as unknown as Express.Multer.File,
      ],
      cookies: { anon_id: 'anon-image-only' },
    } as Partial<express.Request>);
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    const body = capturedJson() as {
      code: string;
      message: string;
      filename: string;
      photoToDeckUrl: string;
    };
    expect(body.code).toBe('image_only_no_text');
    expect(body.photoToDeckUrl).toBe('/photo-to-deck');
    expect(body.filename).toBe('lecture-page.png');
    expect(body.message).toMatch(/Photo to Deck/);
    expect(trackMock).toHaveBeenCalledWith(
      'image_only_no_text_shown',
      expect.objectContaining({
        anonymousId: 'anon-image-only',
        props: expect.objectContaining({ source: 'upload' }),
      })
    );
  });

  it('keeps the plain empty_export state for a non-image file that yields 0 cards', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    const body = capturedJson() as { code: string };
    expect(body.code).toBe('empty_export');
    expect(trackMock).not.toHaveBeenCalledWith(
      'image_only_no_text_shown',
      expect.anything()
    );
  });

  it('tells the user what it read when a text document yields 0 cards', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const html =
      '<h1>Cell biology</h1><p>The nucleus holds DNA.</p><ul><li>one</li><li>two</li></ul>';
    const req = buildRequest({
      files: [
        {
          originalname: 'notes.html',
          mimetype: 'text/html',
          size: html.length,
          buffer: Buffer.from(html, 'utf8'),
        },
      ],
    } as unknown as Partial<express.Request>);
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect(capturedJson()).toMatchObject({
      code: 'empty_export',
      reading: {
        kind: 'document',
        words: 8,
        headings: 1,
        listItems: 2,
        tables: 0,
        toggles: 0,
        images: 0,
      },
    });
  });

  it('offers the rescue candidates the worker found on the empty response', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [],
          emptyReason: 'no_toggles',
          rescueCandidates: [
            { rule: 'heading', cards: 14 },
            { rule: 'bullets', cards: 40 },
          ],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(buildRequest(), res);

    expect(capturedStatus()).toBe(400);
    expect(capturedJson()).toMatchObject({
      code: 'empty_export',
      empty_reason: 'no_toggles',
      rescue: [
        { rule: 'heading', cards: 14 },
        { rule: 'bullets', cards: 40 },
      ],
    });
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({
          rescue_offered: ['heading', 'bullets'],
        }),
      })
    );
  });

  it('offers no rescue for a multi-file submit, whose offer would describe one file', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [],
          emptyReason: 'no_toggles',
          rescueCandidates: [{ rule: 'heading', cards: 2 }],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [
        { originalname: 'a.html', mimetype: 'text/html', size: 10 },
        { originalname: 'b.html', mimetype: 'text/html', size: 10 },
      ],
    } as unknown as Partial<express.Request>);
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedJson()).toMatchObject({ code: 'empty_export', rescue: [] });
  });

  it('routes a zip of nothing but images to Photo to Deck', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });
    const { zipSync, strToU8 } = await import('fflate');
    const zip = Buffer.from(
      zipSync({ 'a.png': strToU8('png'), 'b.jpg': strToU8('jpg') })
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [
        {
          originalname: 'photos.zip',
          mimetype: 'application/zip',
          size: zip.length,
          buffer: zip,
        },
      ],
    } as unknown as Partial<express.Request>);
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect(capturedJson()).toMatchObject({
      code: 'image_only_no_text',
      photoToDeckUrl: '/photo-to-deck',
    });
    expect(trackMock).toHaveBeenCalledWith(
      'image_only_no_text_shown',
      expect.objectContaining({
        props: expect.objectContaining({ container: 'zip' }),
      })
    );
  });

  it.each([
    ['a readable page', { 'a.png': 'png', 'Page abc.html': '<html></html>' }],
    ['a nested zip', { 'a.png': 'png', 'inner.zip': 'PK' }],
    ['an unknown file', { 'a.png': 'png', 'deck.colpkg': 'x' }],
  ])(
    'keeps the plain empty state for a zip of images plus %s',
    async (_label, entries) => {
      MockGeneratePackagesUseCase.mockImplementation(function () {
        return {
          execute: vi.fn().mockResolvedValue({ packages: [] }),
        } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
      });
      const { zipSync, strToU8 } = await import('fflate');
      const zip = Buffer.from(
        zipSync(
          Object.fromEntries(
            Object.entries(entries).map(([name, text]) => [name, strToU8(text)])
          )
        )
      );

      const service = new UploadService(
        buildRepository(),
        {} as JobRepository,
        buildUsersRepo(),
        ...fakeUploadServiceDeps()
      );
      const req = buildRequest({
        files: [
          {
            originalname: 'mixed.zip',
            mimetype: 'application/zip',
            size: zip.length,
            buffer: zip,
          },
        ],
      } as unknown as Partial<express.Request>);
      const { res, capturedJson } = buildResponse();

      await service.handleUpload(req, res);

      expect(capturedJson()).toMatchObject({
        code: 'empty_export',
        reading: { kind: 'zip', imageFiles: 1 },
      });
    }
  );

  it('sends reading null when the empty file cannot be read back', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(buildRequest(), res);

    expect(capturedJson()).toMatchObject({
      code: 'empty_export',
      reading: null,
    });
  });

  it('EmptyDeckError response body contains no HTML tags', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    const body = capturedJson() as { message: string };
    expect(body.message).not.toMatch(/<[a-z]/i);
  });

  it('uses in-memory uploaded file contents for empty-deck diagnostics when no disk path exists', async () => {
    const infoSpy = vi
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      MockGeneratePackagesUseCase.mockImplementation(function () {
        return {
          execute: vi.fn().mockResolvedValue({ packages: [] }),
        } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
      });

      const service = new UploadService(
        buildRepository(),
        {} as JobRepository,
        buildUsersRepo(),
        ...fakeUploadServiceDeps()
      );
      const req = buildRequest({
        files: [
          {
            fieldname: 'files',
            originalname: 'memory-upload.html',
            encoding: '7bit',
            mimetype: 'text/html',
            size: 36,
            buffer: Buffer.from('<details><summary>Q</summary>A</details>'),
          } as Express.Multer.File,
        ],
      });
      const { res, capturedStatus } = buildResponse();

      await service.handleUpload(req, res);

      expect(capturedStatus()).toBe(400);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('<details=true')
      );
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('returns 400 JSON when deck serialization overflows (DeckTooLargeError path)', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockRejectedValue(new DeckTooLargeError()),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    const body = capturedJson() as { message: string };
    expect(typeof body.message).toBe('string');
    expect(body.message).not.toMatch(/<[a-z]/i);
    expect(body.message).not.toMatch(/Invalid string length/i);
    expect(body.message).toMatch(/split/i);
  });

  it('DeckTooLargeError response body contains no stack trace or V8 internals', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockRejectedValue(new DeckTooLargeError()),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    const body = capturedJson() as { message: string };
    expect(body.message).not.toMatch(/at .*\(/);
    expect(body.message).not.toMatch(/RangeError/);
  });

  it('returns 400 with code docx_processing_failed when convertDocxToHTML throws a docx_parse_failed error', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi
          .fn()
          .mockRejectedValue(
            new Error(
              'docx_parse_failed: Could not find the body element: are you sure this is a docx file?'
            )
          ),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [
        {
          fieldname: 'files',
          originalname: 'notes.docx',
          mimetype:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 1024,
          path: '/tmp/notes.docx',
          encoding: '7bit',
          destination: '/tmp',
          filename: 'notes.docx',
          buffer: Buffer.alloc(0),
          stream: null,
        } as unknown as Express.Multer.File,
      ],
    });
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    const body = capturedJson() as { code: string; message: string };
    expect(body.code).toBe('docx_processing_failed');
    expect(typeof body.message).toBe('string');
    expect(body.message).not.toMatch(/docx_parse_failed/);
  });

  it('answers a sync upload whose worker crashed without sending the worker stack', async () => {
    const crash = Object.assign(
      new Error("Cannot read properties of undefined (reading '0')"),
      { name: 'TypeError' }
    );
    crash.stack =
      "TypeError: Cannot read properties of undefined (reading '0')\n" +
      '    at firstCell (/app/src/lib/parser/tables.ts:12:3)';
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockRejectedValue(crash),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(buildRequest(), res);

    expect(capturedStatus()).toBe(400);
    expect(capturedJson()).toEqual({
      code: 'unknown',
      message: "Cannot read properties of undefined (reading '0')",
    });
    errorSpy.mockRestore();
  });

  it('answers 503 with the retry copy when the pool drain interrupts a sync upload', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockRejectedValue(createWorkerTerminationError()),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(503);
    expect(capturedJson()).toEqual({
      code: 'unknown',
      message: WORKER_INTERRUPTED_REASON,
    });
    expect(trackMock).not.toHaveBeenCalledWith(
      'conversion_failed',
      expect.anything()
    );
  });

  it('returns 400 with code pdf_processing_failed when pdf.js rejects the file structure', async () => {
    const invalidPdf = new Error('Invalid PDF structure');
    invalidPdf.name = 'InvalidPDFException';
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockRejectedValue(invalidPdf),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [
        {
          fieldname: 'files',
          originalname: 'notes.pdf',
          mimetype: 'application/pdf',
          size: 1024,
          path: '/tmp/notes.pdf',
          encoding: '7bit',
          destination: '/tmp',
          filename: 'notes.pdf',
          buffer: Buffer.alloc(0),
          stream: null,
        } as unknown as Express.Multer.File,
      ],
    });
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    const body = capturedJson() as { code: string; message: string };
    expect(body.code).toBe('pdf_processing_failed');
    expect(body.message).not.toMatch(/Invalid PDF structure/);
    expect(body.message).toMatch(/could not read this PDF/);
    // A damaged file is a user-input state, like a pdfinfo failure: it is not
    // a conversion failure for the funnel or a red tile for ops (#4496).
    expect(trackMock).not.toHaveBeenCalledWith(
      'conversion_failed',
      expect.anything()
    );
  });

  it('answers 409 choose_pdf_mode, without a failure event, when a PDF needs the person to choose', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockRejectedValue(
          new Error(
            buildPdfFallbackChoiceSentinel({
              reason: 'no_text',
              pageCount: 31,
            })
          )
        ),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({ aborted: false } as Partial<express.Request>);
    const { res, capturedStatus, capturedJson } = buildResponse();
    trackMock.mockClear();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(409);
    expect(capturedJson()).toEqual({
      code: 'choose_pdf_mode',
      reason: 'no_text',
      page_count: 31,
    });
    expect(trackMock).not.toHaveBeenCalledWith(
      'conversion_failed',
      expect.anything()
    );
  });

  it('answers 400 upload_incomplete when the uploaded file is gone and the client is still waiting', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi
          .fn()
          .mockRejectedValue(new UploadFileUnavailableError('notes.zip')),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({ aborted: false } as Partial<express.Request>);
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect(capturedJson()).toMatchObject({ code: 'upload_incomplete' });
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({ reason: 'upload_incomplete' }),
      })
    );
  });

  it.each([
    ['the request aborted mid-body', { aborted: true }, {}],
    ['the response socket was destroyed', {}, { destroyed: true }],
    ['the response had already ended', {}, { writableEnded: true }],
  ])(
    'records client_left and answers nothing when %s before the file was read',
    async (_shape, reqState, resState) => {
      MockGeneratePackagesUseCase.mockImplementation(function () {
        return {
          execute: vi
            .fn()
            .mockRejectedValue(new UploadFileUnavailableError('notes.zip')),
        } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
      });

      const service = new UploadService(
        buildRepository(),
        {} as JobRepository,
        buildUsersRepo(),
        ...fakeUploadServiceDeps()
      );
      const req = buildRequest(reqState as Partial<express.Request>);
      const { res, capturedStatus, capturedJson } = buildResponse();
      Object.assign(res, resState);

      await service.handleUpload(req, res);

      expect(capturedStatus()).toBe(0);
      expect(capturedJson()).toBeNull();
      expect(trackMock).toHaveBeenCalledWith(
        'conversion_failed',
        expect.objectContaining({
          props: expect.objectContaining({ reason: 'client_left' }),
        })
      );
      expect(trackMock).not.toHaveBeenCalledWith(
        'conversion_failed',
        expect.objectContaining({
          props: expect.objectContaining({ reason: 'upload_incomplete' }),
        })
      );
    }
  );

  it('rejects .apkg upload with 400 and the "already an Anki deck" message before reaching GeneratePackagesUseCase', async () => {
    const executeMock = vi.fn();
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: executeMock,
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [
        {
          originalname: 'my-deck.apkg',
          mimetype: 'application/octet-stream',
          size: 82138,
          path: '/tmp/abc123',
          fieldname: 'pakker',
          encoding: '7bit',
          destination: '/tmp',
          filename: 'abc123',
          buffer: Buffer.alloc(0),
          stream: null,
          key: '',
        } as unknown as Express.Multer.File,
      ],
    });
    const { res, capturedStatus, capturedSend } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect(typeof capturedSend()).toBe('string');
    expect(capturedSend() as string).toContain('already an Anki deck');
    expect(executeMock).not.toHaveBeenCalled();
  });
});

describe('UploadService.handleSyncUpload — card-limit enforcement', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    trackMock.mockClear();
    mockFirstApkg = Buffer.from('fake-apkg');
    mockWorkspaceId = 'test-ws-id';
  });

  function mockPackages(
    packages: Array<{
      name: string;
      cardCount: number;
      pdfPageCount?: number;
      guidEntries?: IssuedCardGuid[];
      uploadIdentityStats?: {
        replayed: number;
        issued: number;
        guarded: number;
      };
    }>,
    warnings?: string[]
  ) {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages, warnings }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });
  }

  function responseWithRedirect() {
    const built = buildResponse();
    let redirectedTo: string | null = null;
    (built.res.redirect as unknown as Mock).mockImplementation(
      (url: string) => {
        redirectedTo = url;
        return built.res;
      }
    );
    return { ...built, redirectedTo: () => redirectedTo };
  }

  it('emits conversion_started before the parser runs on the sync path', async () => {
    mockPackages([{ name: 'deck', cardCount: 12 }]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      cookies: { anon_id: 'anon-sync-start' },
    } as Partial<express.Request>);
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(trackMock).toHaveBeenCalledWith(
      'conversion_started',
      expect.objectContaining({
        anonymousId: 'anon-sync-start',
        props: expect.objectContaining({ source: 'upload', mode: 'sync' }),
      })
    );
    const startOrder = trackMock.mock.calls.findIndex(
      (call) => call[0] === 'conversion_started'
    );
    const successOrder = trackMock.mock.calls.findIndex(
      (call) => call[0] === 'conversion_succeeded'
    );
    expect(startOrder).toBeGreaterThanOrEqual(0);
    expect(startOrder).toBeLessThan(successOrder);
  });

  it('tags conversion_succeeded with the PDF page-count bucket on the sync path', async () => {
    mockPackages([{ name: 'deck', cardCount: 12, pdfPageCount: 42 }]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [
        {
          originalname: 'lecture.pdf',
          mimetype: 'application/pdf',
          size: 2048,
          path: '/tmp/lecture.pdf',
        },
      ],
    } as unknown as Partial<express.Request>);
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(trackMock).toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.objectContaining({
        props: expect.objectContaining({
          input_format: 'pdf',
          card_count_bucket: '3-49',
          page_count_bucket: '21-50',
        }),
      })
    );
  });

  it('omits the PDF page-count bucket when no PDF pages were converted', async () => {
    mockPackages([{ name: 'deck', cardCount: 10 }]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    const successCall = trackMock.mock.calls.find(
      (call) => call[0] === 'conversion_succeeded'
    );
    expect(successCall).toBeDefined();
    expect(successCall?.[1].props).not.toHaveProperty('page_count_bucket');
  });

  it('redirects a logged-in free user over the monthly limit to /limit?kind=card_count and does not send the deck', async () => {
    mockPackages([{ name: 'deck', cardCount: 30 }]);
    const usersRepo = buildUsersRepo({
      getCardUsage: vi
        .fn()
        .mockResolvedValue({ cards_used: 80, month_started_at: new Date() }),
    });
    const incrementSpy = usersRepo.incrementCardUsage as Mock;

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedSend, redirectedTo } = responseWithRedirect();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(redirectedTo()).toBe('/limit?kind=card_count');
    expect(capturedSend()).toBeNull();
    expect(incrementSpy).not.toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        userId: 42,
        props: expect.objectContaining({
          reason: 'monthly_limit',
          source: 'upload',
        }),
      })
    );
    expect(trackMock).toHaveBeenCalledWith(
      'paywall_shown',
      expect.objectContaining({
        userId: 42,
        props: expect.objectContaining({
          kind: 'card_count',
          source: 'upload',
        }),
      })
    );
  });

  it('re-keys the guid ledger through reissue when block-id identity is on', async () => {
    const guidEntries = [
      { blockId: 'block-a', sourcePageId: 'page-1', guid: 'block-guid-a' },
    ];
    mockPackages([{ name: 'deck', cardCount: 1, guidEntries }]);
    const guidLedger = {
      getAllForOwner: vi.fn().mockResolvedValue({ 'block-a': 'old-guid' }),
      getUploadIdentityForOwner: vi.fn().mockResolvedValue({}),
      record: vi.fn().mockResolvedValue(undefined),
      reissue: vi.fn().mockResolvedValue(undefined),
    };

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ guidLedger })
    );
    const req = buildRequest({
      body: { 'block-id-identity': 'true' },
    } as Partial<express.Request>);
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(guidLedger.reissue).toHaveBeenCalledWith(42, guidEntries);
    expect(guidLedger.record).not.toHaveBeenCalled();
  });

  it('merges upload identity rows and records Notion rows separately', async () => {
    const notionEntry = {
      blockId: 'block-a',
      sourcePageId: 'page-1',
      guid: 'content-guid-a',
    };
    const uploadEntry = {
      blockId: 'u:front-key',
      sourcePageId: 'hash:fingerprint',
      guid: 'upload-guid',
    };
    mockPackages([
      { name: 'deck', cardCount: 2, guidEntries: [notionEntry, uploadEntry] },
    ]);
    const guidLedger = {
      getAllForOwner: vi.fn().mockResolvedValue({}),
      getUploadIdentityForOwner: vi.fn().mockResolvedValue({}),
      record: vi.fn().mockResolvedValue(undefined),
      reissue: vi.fn().mockResolvedValue(undefined),
    };

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ guidLedger })
    );
    const req = buildRequest();
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(guidLedger.record).toHaveBeenCalledWith(42, [notionEntry]);
    expect(guidLedger.reissue).toHaveBeenCalledWith(42, [uploadEntry]);
  });

  it('pins new guids through the insert-only record path by default', async () => {
    const guidEntries = [
      { blockId: 'block-a', sourcePageId: 'page-1', guid: 'content-guid-a' },
    ];
    mockPackages([{ name: 'deck', cardCount: 1, guidEntries }]);
    const guidLedger = {
      getAllForOwner: vi.fn().mockResolvedValue({}),
      getUploadIdentityForOwner: vi.fn().mockResolvedValue({}),
      record: vi.fn().mockResolvedValue(undefined),
      reissue: vi.fn().mockResolvedValue(undefined),
    };

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ guidLedger })
    );
    const req = buildRequest();
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(guidLedger.record).toHaveBeenCalledWith(42, guidEntries);
    expect(guidLedger.reissue).not.toHaveBeenCalled();
  });

  it('emits upload_identity_replayed with the summed counts for a signed-in upload', async () => {
    mockPackages([
      {
        name: 'deck',
        cardCount: 3,
        uploadIdentityStats: { replayed: 1, issued: 2, guarded: 0 },
      },
      {
        name: 'deck-2',
        cardCount: 1,
        uploadIdentityStats: { replayed: 0, issued: 1, guarded: 1 },
      },
    ]);
    const guidLedger = {
      getAllForOwner: vi.fn().mockResolvedValue({}),
      getUploadIdentityForOwner: vi
        .fn()
        .mockResolvedValue({ 'u:abc': { guid: 'g', sourcePageId: 'h:f' } }),
      record: vi.fn().mockResolvedValue(undefined),
      reissue: vi.fn().mockResolvedValue(undefined),
    };

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ guidLedger })
    );
    const req = buildRequest();
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(guidLedger.getUploadIdentityForOwner).toHaveBeenCalledWith(42);
    expect(trackMock).toHaveBeenCalledWith('upload_identity_replayed', {
      userId: 42,
      props: { replayed: 1, issued: 3, guarded: 1 },
    });
  });

  it('does not emit upload_identity_replayed when no package carries identity stats', async () => {
    mockPackages([{ name: 'deck', cardCount: 3 }]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(trackMock).not.toHaveBeenCalledWith(
      'upload_identity_replayed',
      expect.anything()
    );
  });

  it('sends the deck and increments card usage for a logged-in free user under the limit', async () => {
    mockPackages([{ name: 'deck', cardCount: 30 }]);
    const usersRepo = buildUsersRepo({
      getCardUsage: vi
        .fn()
        .mockResolvedValue({ cards_used: 10, month_started_at: new Date() }),
    });
    const incrementSpy = usersRepo.incrementCardUsage as Mock;

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus, capturedSend } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(capturedSend()).not.toBeNull();
    expect(incrementSpy).toHaveBeenCalledWith(42, 30);
  });

  it('redirects an anonymous conversion over 21 cards to /limit?kind=anonymous and does not send the deck', async () => {
    mockPackages([{ name: 'deck', cardCount: 22 }]);
    const usersRepo = buildUsersRepo();
    const incrementSpy = usersRepo.incrementCardUsage as Mock;

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedSend, redirectedTo } = responseWithRedirect();

    await service.handleUpload(req, res);

    expect(redirectedTo()).toBe('/limit?kind=anonymous');
    expect(capturedSend()).toBeNull();
    expect(incrementSpy).not.toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        userId: null,
        anonymousId: null,
        props: expect.objectContaining({
          reason: 'anonymous_cap',
          source: 'upload',
        }),
      })
    );
    expect(trackMock).toHaveBeenCalledWith(
      'paywall_shown',
      expect.objectContaining({
        userId: null,
        anonymousId: null,
        props: expect.objectContaining({ kind: 'anonymous', source: 'upload' }),
      })
    );
  });

  it('treats a session cookie that resolves to no user as signed out', async () => {
    mockPackages([{ name: 'deck', cardCount: 22 }]);
    const usersRepo = buildUsersRepo();

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      cookies: { token: 'an-expired-session-token' },
    } as Partial<express.Request>);
    const { res, capturedSend, redirectedTo } = responseWithRedirect();

    await service.handleUpload(req, res);

    expect(redirectedTo()).toBe('/limit?kind=anonymous');
    expect(capturedSend()).toBeNull();
    expect(trackMock).toHaveBeenCalledWith(
      'paywall_shown',
      expect.objectContaining({
        userId: null,
        props: expect.objectContaining({ kind: 'anonymous', source: 'upload' }),
      })
    );
  });

  it('sets X-Dropped-Assets to the summed dropped-image count across packages on a single-deck sync upload', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'deck',
              cardCount: 12,
              mcqCount: 0,
              mcqSkippedCount: 0,
              droppedImageCount: 2,
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(res.set).toHaveBeenCalledWith('X-Dropped-Assets', '2');
  });

  it('does not set X-Dropped-Assets when no images were dropped', async () => {
    mockPackages([{ name: 'deck', cardCount: 12 }]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(res.set).not.toHaveBeenCalledWith(
      'X-Dropped-Assets',
      expect.anything()
    );
  });

  it('flags notion_html_no_folder and persists it when an HTML-only upload drops a local image', async () => {
    const update = vi.fn().mockResolvedValue([] as Uploads[]);
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'deck',
              cardCount: 12,
              droppedImageCount: 2,
              missingLocalImageCount: 2,
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      { ...buildRepository(), update },
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [
        {
          originalname: 'notes.html',
          mimetype: 'text/html',
          size: 1024,
          path: '/tmp/notes.html',
        },
      ],
    } as unknown as Partial<express.Request>);
    const { res, capturedStatus } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(res.set).toHaveBeenCalledWith(
      'X-Image-Drop-Reason',
      'notion_html_no_folder'
    );
    expect(update).toHaveBeenCalledWith(
      42,
      'deck',
      expect.any(String),
      expect.any(Number),
      null,
      { droppedImageCount: 2, imageDropReason: 'notion_html_no_folder' }
    );
  });

  it('flags plain_text_fallback and persists it when the plain-text fallback drops images', async () => {
    const update = vi.fn().mockResolvedValue([] as Uploads[]);
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'deck',
              cardCount: 5,
              droppedImageCount: 2,
              missingLocalImageCount: 0,
              plainTextFallbackImageCount: 2,
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      { ...buildRepository(), update },
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [
        {
          originalname: 'notes.html',
          mimetype: 'text/html',
          size: 1024,
          path: '/tmp/notes.html',
        },
      ],
    } as unknown as Partial<express.Request>);
    const { res, capturedStatus } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(res.set).toHaveBeenCalledWith(
      'X-Image-Drop-Reason',
      'plain_text_fallback'
    );
    expect(update).toHaveBeenCalledWith(
      42,
      'deck',
      expect.any(String),
      expect.any(Number),
      null,
      { droppedImageCount: 2, imageDropReason: 'plain_text_fallback' }
    );
  });

  it('keeps the generic guidance when a dropped image on an HTML upload is a remote drop, not a missing local path', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'deck',
              cardCount: 12,
              droppedImageCount: 1,
              missingLocalImageCount: 0,
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [
        {
          originalname: 'notes.html',
          mimetype: 'text/html',
          size: 1024,
          path: '/tmp/notes.html',
        },
      ],
    } as unknown as Partial<express.Request>);
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(res.set).not.toHaveBeenCalledWith(
      'X-Image-Drop-Reason',
      expect.anything()
    );
  });

  it('does not flag notion_html_no_folder for a zip upload even when a local image is missing', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'deck',
              cardCount: 12,
              droppedImageCount: 2,
              missingLocalImageCount: 2,
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(res.set).not.toHaveBeenCalledWith(
      'X-Image-Drop-Reason',
      expect.anything()
    );
  });

  it('sets X-Credits-Used from the request cost on a single-deck sync upload', async () => {
    mockPackages([{ name: 'deck', cardCount: 12 }]);
    const costByRequestId = vi.fn().mockResolvedValue(0.88);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ aiRequestCost: { costByRequestId } })
    );
    const req = buildRequest();
    const { res, capturedStatus } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).requestId = 'req-abc';

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(costByRequestId).toHaveBeenCalledWith(
      42,
      'req-abc',
      expect.any(Date)
    );
    expect(res.set).toHaveBeenCalledWith('X-Credits-Used', '88');
  });

  it('omits X-Credits-Used when the conversion recorded no AI cost', async () => {
    mockPackages([{ name: 'deck', cardCount: 12 }]);
    const costByRequestId = vi.fn().mockResolvedValue(0);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ aiRequestCost: { costByRequestId } })
    );
    const req = buildRequest();
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).requestId = 'req-abc';

    await service.handleUpload(req, res);

    expect(res.set).not.toHaveBeenCalledWith(
      'X-Credits-Used',
      expect.anything()
    );
  });

  it('fails open, still returning the deck, when the cost lookup rejects', async () => {
    mockPackages([{ name: 'deck', cardCount: 12 }]);
    const costByRequestId = vi
      .fn()
      .mockRejectedValue(new Error('metrics unavailable'));

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ aiRequestCost: { costByRequestId } })
    );
    const req = buildRequest();
    const { res, capturedStatus } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).requestId = 'req-abc';

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(res.set).not.toHaveBeenCalledWith(
      'X-Credits-Used',
      expect.anything()
    );
  });

  it('sets X-Expired-Notion-Assets to the summed expired-image count on a single-deck sync upload', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'deck',
              cardCount: 12,
              mcqCount: 0,
              mcqSkippedCount: 0,
              droppedImageCount: 1,
              expiredNotionImageCount: 1,
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(res.set).toHaveBeenCalledWith('X-Expired-Notion-Assets', '1');
  });

  it('does not set X-Expired-Notion-Assets when no Notion images expired', async () => {
    mockPackages([{ name: 'deck', cardCount: 12 }]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(res.set).not.toHaveBeenCalledWith(
      'X-Expired-Notion-Assets',
      expect.anything()
    );
  });

  it('sets X-Empty-Back-Count to the summed empty-back count on a partial single-deck upload', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'deck',
              cardCount: 9,
              mcqCount: 0,
              mcqSkippedCount: 0,
              emptyBackCount: 3,
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus, capturedSend } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(capturedSend()).not.toBeNull();
    expect(res.set).toHaveBeenCalledWith('X-Empty-Back-Count', '3');
  });

  it('does not set X-Empty-Back-Count when no cards were empty-back', async () => {
    mockPackages([{ name: 'deck', cardCount: 12 }]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(res.set).not.toHaveBeenCalledWith(
      'X-Empty-Back-Count',
      expect.anything()
    );
  });

  it('sets X-Structure-Rescued to the shipped rescue rule on a single-deck sync upload', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'deck',
              cardCount: 8,
              mcqCount: 0,
              mcqSkippedCount: 0,
              inducedRule: { rule: 'heading', outcome: 'rescue_shipped' },
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(res.set).toHaveBeenCalledWith('X-Structure-Rescued', 'heading');
  });

  it('does not set X-Structure-Rescued when the rescue was rejected', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'deck',
              cardCount: 8,
              mcqCount: 0,
              mcqSkippedCount: 0,
              inducedRule: { rule: 'bullets', outcome: 'rescue_rejected' },
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(res.set).not.toHaveBeenCalledWith(
      'X-Structure-Rescued',
      expect.anything()
    );
  });

  it('does not set X-Structure-Rescued when no rescue ran', async () => {
    mockPackages([{ name: 'deck', cardCount: 12 }]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(res.set).not.toHaveBeenCalledWith(
      'X-Structure-Rescued',
      expect.anything()
    );
  });

  it('surfaces a skipped-locked-PDF note on X-Warning when a ZIP entry stays locked', async () => {
    const lockedWarning =
      '2 password-protected PDFs were skipped: Ch1.pdf, Ch2.pdf. Unlock each in Preview or Adobe Reader, save a copy, and upload them on their own.';
    mockPackages([{ name: 'notes.html', cardCount: 12 }], [lockedWarning]);
    const usersRepo = buildUsersRepo();

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(res.set).toHaveBeenCalledWith('X-Warning', lockedWarning);
  });

  it('warns on X-Warning when notes in the built package share a guid', async () => {
    const previousLocation = mockWorkspaceLocation;
    mockWorkspaceLocation = fs.mkdtempSync(
      path.join(os.tmpdir(), 'upload-dup-guid-')
    );
    fs.writeFileSync(
      path.join(mockWorkspaceLocation, 'guids.json'),
      JSON.stringify([
        { notionId: null, guid: 'same' },
        { notionId: null, guid: 'same' },
        { notionId: null, guid: 'other' },
      ])
    );
    mockPackages([{ name: 'notes.html', cardCount: 3 }]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus } = buildResponse();

    try {
      await service.handleUpload(req, res);
    } finally {
      mockWorkspaceLocation = previousLocation;
    }

    expect(capturedStatus()).toBe(200);
    expect(res.set).toHaveBeenCalledWith(
      'X-Warning',
      expect.stringMatching(/^1 card is an exact duplicate/)
    );
  });

  it('sends X-Warning as Latin-1 even when the warning copy carries typographic characters', async () => {
    // Node's setHeader throws ERR_INVALID_CHAR on anything above U+00FF, which
    // 400'd every duplicate-card upload for four hours on 2026-09-25 after an
    // em dash landed in the warning copy. Password warnings pass through
    // verbatim, so they are the easiest way to push such a character in.
    const lockedWarning =
      '1 password-protected PDF was skipped — unlock it and upload again.';
    mockPackages([{ name: 'notes.html', cardCount: 12 }], [lockedWarning]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(res.set).toHaveBeenCalledWith(
      'X-Warning',
      '1 password-protected PDF was skipped - unlock it and upload again.'
    );
  });

  it('tracks upload_duplicate_guids_collapsed with the count when notes share a guid', async () => {
    const previousLocation = mockWorkspaceLocation;
    mockWorkspaceLocation = fs.mkdtempSync(
      path.join(os.tmpdir(), 'upload-dup-guid-track-')
    );
    fs.writeFileSync(
      path.join(mockWorkspaceLocation, 'guids.json'),
      JSON.stringify([
        { notionId: null, guid: 'same' },
        { notionId: null, guid: 'same' },
        { notionId: null, guid: 'other' },
      ])
    );
    mockPackages([{ name: 'notes.html', cardCount: 3 }]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      cookies: { anon_id: 'anon-dup-guid-track' },
    } as Partial<express.Request>);
    const { res } = buildResponse();

    try {
      await service.handleUpload(req, res);
    } finally {
      mockWorkspaceLocation = previousLocation;
    }

    expect(trackMock).toHaveBeenCalledWith(
      'upload_duplicate_guids_collapsed',
      expect.objectContaining({
        anonymousId: 'anon-dup-guid-track',
        props: { count: 1 },
      })
    );
  });

  it('does not track upload_duplicate_guids_collapsed when no guid collides', async () => {
    mockPackages([{ name: 'deck', cardCount: 3 }]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(trackMock).not.toHaveBeenCalledWith(
      'upload_duplicate_guids_collapsed',
      expect.anything()
    );
  });

  it('sends the deck for an anonymous conversion at or under 21 cards without incrementing usage', async () => {
    mockPackages([{ name: 'deck', cardCount: 21 }]);
    const usersRepo = buildUsersRepo();
    const incrementSpy = usersRepo.incrementCardUsage as Mock;

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus, capturedSend } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(capturedSend()).not.toBeNull();
    expect(incrementSpy).not.toHaveBeenCalled();
  });

  it('returns 400 empty_export instead of a silent empty deck when the single package has 0 cards', async () => {
    mockPackages([{ name: 'deck', cardCount: 0 }]);
    const usersRepo = buildUsersRepo();
    const incrementSpy = usersRepo.incrementCardUsage as Mock;

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus, capturedSend, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect(capturedSend()).toBeNull();
    const body = capturedJson() as { code: string };
    expect(body.code).toBe('empty_export');
    expect(incrementSpy).not.toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({ reason: 'empty_deck' }),
      })
    );
  });

  it('returns 400 empty_export when every package across a batch has 0 cards', async () => {
    mockPackages([
      { name: 'deck-a', cardCount: 0 },
      { name: 'deck-b', cardCount: 0 },
    ]);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    const body = capturedJson() as { code: string };
    expect(body.code).toBe('empty_export');
  });
});

describe('UploadService.handleSyncUpload — zero-card Claude fallback', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  let tmpDir: string;
  let infoSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(
      os.tmpdir(),
      'upload-service-fallback'
    );
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    trackMock.mockClear();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fallback-ws-'));
    mockWorkspaceLocation = tmpDir;
    mockWorkspaceId = 'fallback-ws-id';
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function zeroCardUseCase() {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });
  }

  function jobRepositoryWithFailedGate(onFailed?: () => void): JobRepository {
    return {
      create: vi.fn().mockResolvedValue(undefined),
      updateJobStatus: vi
        .fn()
        .mockImplementation((_id: string, _owner: string, status: string) => {
          if (status === 'failed') {
            onFailed?.();
          }
          return Promise.resolve(undefined);
        }),
      findJobById: vi.fn().mockResolvedValue(null),
      deleteJob: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;
  }

  function entitledRequest(
    overrides: Partial<express.Request> = {}
  ): express.Request {
    return buildRequest({
      files: [
        {
          originalname: 'lecture.html',
          mimetype: 'text/html',
          size: 4096,
          path: '/tmp/lecture.html',
        } as unknown as Express.Multer.File,
      ],
      ...overrides,
    });
  }

  function entitledResponse() {
    const built = buildResponse();
    (built.res.locals as Record<string, unknown>).owner = 42;
    (built.res.locals as Record<string, unknown>).subscriber = true;
    return built;
  }

  it('dispatches an async Claude job with 202 when an entitled user with AI never set gets zero cards', async () => {
    zeroCardUseCase();
    let resolveFailed!: () => void;
    const failed = new Promise<void>((r) => {
      resolveFailed = r;
    });
    const jobRepository = jobRepositoryWithFailedGate(resolveFailed);
    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = entitledRequest();
    const { res, capturedStatus, capturedJson } = entitledResponse();

    await service.handleUpload(req, res);
    await failed;

    expect(capturedStatus()).toBe(202);
    expect(capturedJson()).toEqual({ jobId: 'fallback-ws-id' });
    expect(jobRepository.create).toHaveBeenCalledWith(
      'fallback-ws-id',
      '42',
      expect.any(String),
      'claude'
    );
    expect(trackMock).toHaveBeenCalledWith(
      'ai_fallback_triggered',
      expect.objectContaining({
        userId: 42,
        props: expect.objectContaining({ reason: 'empty_deck' }),
      })
    );
  });

  it('keeps the empty_export error when an entitled user explicitly turned AI off', async () => {
    zeroCardUseCase();
    const jobRepository = jobRepositoryWithFailedGate();
    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = entitledRequest({
      body: { 'claude-ai-flashcards': 'false' },
    } as Partial<express.Request>);
    const { res, capturedStatus, capturedJson } = entitledResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect((capturedJson() as { code: string }).code).toBe('empty_export');
    expect(jobRepository.create).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalledWith(
      'ai_fallback_triggered',
      expect.anything()
    );
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({ reason: 'empty_deck' }),
      })
    );
  });

  it('keeps the empty_export error for a signed-in free user who is not entitled', async () => {
    zeroCardUseCase();
    const jobRepository = jobRepositoryWithFailedGate();
    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = entitledRequest();
    const { res, capturedStatus, capturedJson } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect((capturedJson() as { code: string }).code).toBe('empty_export');
    expect(jobRepository.create).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalledWith(
      'ai_fallback_triggered',
      expect.anything()
    );
  });

  it('keeps the empty_export error for an anonymous upload', async () => {
    zeroCardUseCase();
    const jobRepository = jobRepositoryWithFailedGate();
    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = entitledRequest();
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect((capturedJson() as { code: string }).code).toBe('empty_export');
    expect(jobRepository.create).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalledWith(
      'ai_fallback_triggered',
      expect.anything()
    );
  });

  it('keeps the empty_export error when the entitled upload exceeds the Claude fallback size cap', async () => {
    zeroCardUseCase();
    const jobRepository = jobRepositoryWithFailedGate();
    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = entitledRequest({
      files: [
        {
          originalname: 'huge.html',
          mimetype: 'text/html',
          size: 60 * 1024 * 1024,
          path: '/tmp/huge.html',
        } as unknown as Express.Multer.File,
      ],
    } as Partial<express.Request>);
    const { res, capturedStatus, capturedJson } = entitledResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect((capturedJson() as { code: string }).code).toBe('empty_export');
    expect(jobRepository.create).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalledWith(
      'ai_fallback_triggered',
      expect.anything()
    );
  });

  it('keeps the image_only_no_text response for an entitled image-only upload and does not fall back to Claude', async () => {
    zeroCardUseCase();
    const jobRepository = jobRepositoryWithFailedGate();
    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = entitledRequest({
      files: [
        {
          originalname: 'slide.png',
          mimetype: 'image/png',
          size: 2048,
          path: '/tmp/slide.png',
        } as unknown as Express.Multer.File,
      ],
    } as Partial<express.Request>);
    const { res, capturedStatus, capturedJson } = entitledResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect((capturedJson() as { code: string }).code).toBe(
      'image_only_no_text'
    );
    expect(jobRepository.create).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalledWith(
      'ai_fallback_triggered',
      expect.anything()
    );
  });

  function slidesRequest(): express.Request {
    return buildRequest({
      files: [
        {
          originalname: 'lecture.pptx',
          mimetype:
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          size: 4096,
          path: '/tmp/lecture.pptx',
        } as unknown as Express.Multer.File,
      ],
    });
  }

  function asyncSlowFlag(on: boolean) {
    mockGetFeatureFlag.mockImplementation(async (key: string) =>
      key === 'async_slow_uploads' ? on : false
    );
  }

  it('converts a PowerPoint from a paying signed-in user in the background when the flag is on', async () => {
    zeroCardUseCase();
    asyncSlowFlag(true);
    let resolveFailed!: () => void;
    const failed = new Promise<void>((r) => {
      resolveFailed = r;
    });
    const jobRepository = jobRepositoryWithFailedGate(resolveFailed);
    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const { res, capturedStatus, capturedJson } = entitledResponse();

    await service.handleUpload(slidesRequest(), res);
    await failed;

    expect(capturedStatus()).toBe(202);
    expect(capturedJson()).toEqual({ jobId: 'fallback-ws-id' });
    expect(jobRepository.create).toHaveBeenCalledWith(
      'fallback-ws-id',
      '42',
      'lecture.pptx',
      'upload'
    );
  });

  it('retries a background PowerPoint with AI when it makes no cards, as the normal path does', async () => {
    zeroCardUseCase();
    asyncSlowFlag(true);
    let resolveFailed!: () => void;
    const failed = new Promise<void>((r) => {
      resolveFailed = r;
    });
    const jobRepository = jobRepositoryWithFailedGate(resolveFailed);
    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const { res, capturedStatus } = entitledResponse();

    await service.handleUpload(slidesRequest(), res);
    await failed;
    await new Promise((r) => setImmediate(r));

    expect(capturedStatus()).toBe(202);
    expect(jobRepository.create).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      '42',
      'lecture.pptx',
      'upload'
    );
    expect(jobRepository.create).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      '42',
      'lecture.pptx',
      'claude'
    );
    expect(jobRepository.create).toHaveBeenCalledTimes(2);
    expect(jobRepository.deleteJob).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith(
      'ai_fallback_triggered',
      expect.objectContaining({
        props: expect.objectContaining({ reason: 'empty_deck' }),
      })
    );
  });

  it('keeps a PowerPoint on the normal path when the flag is off', async () => {
    zeroCardUseCase();
    asyncSlowFlag(false);
    const jobRepository = jobRepositoryWithFailedGate();
    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const { res } = entitledResponse();

    await service.handleUpload(slidesRequest(), res);

    expect(jobRepository.create).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'upload'
    );
  });

  it('keeps a PowerPoint on the normal path for an account that is not paying', async () => {
    zeroCardUseCase();
    asyncSlowFlag(true);
    const jobRepository = jobRepositoryWithFailedGate();
    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const built = buildResponse();
    (built.res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(slidesRequest(), built.res);

    expect(jobRepository.create).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'upload'
    );
  });

  it('does not recurse: a fallback job that itself yields zero cards is marked failed once, never re-dispatched', async () => {
    zeroCardUseCase();
    let failedCount = 0;
    let resolveFailed!: () => void;
    const failed = new Promise<void>((r) => {
      resolveFailed = r;
    });
    const jobRepository = jobRepositoryWithFailedGate(() => {
      failedCount += 1;
      resolveFailed();
    });
    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = entitledRequest();
    const { res, capturedStatus } = entitledResponse();

    await service.handleUpload(req, res);
    await failed;
    await new Promise((r) => setImmediate(r));

    expect(capturedStatus()).toBe(202);
    expect(jobRepository.create).toHaveBeenCalledTimes(1);
    const fallbackCalls = trackMock.mock.calls.filter(
      (call) => call[0] === 'ai_fallback_triggered'
    );
    expect(fallbackCalls).toHaveLength(1);
    expect(failedCount).toBe(1);
  });
});

describe('UploadService.deleteUpload — cascade', () => {
  beforeEach(() => {
    mockStorageDelete.mockClear();
  });

  it('removes the upload row, the S3 object, and the linked job', async () => {
    const repo: IUploadRepository = {
      ...buildRepository(),
      findByKey: vi.fn().mockResolvedValue({
        id: 1,
        owner: 7,
        key: 'k.apkg',
        filename: 'k.apkg',
        object_id: 'obj-123',
        size_mb: 1,
        created_at: new Date(),
      } as Uploads),
      deleteUpload: vi.fn().mockResolvedValue(1),
    };
    const jobRepository = {
      deleteJobByObjectId: vi.fn().mockResolvedValue(1),
    } as unknown as JobRepository;

    const service = new UploadService(
      repo,
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    await service.deleteUpload(7, 'k.apkg');

    expect(repo.findByKey).toHaveBeenCalledWith(7, 'k.apkg');
    expect(repo.deleteUpload).toHaveBeenCalledWith(7, 'k.apkg');
    expect(mockStorageDelete).toHaveBeenCalledWith('k.apkg');
    expect(jobRepository.deleteJobByObjectId).toHaveBeenCalledWith(
      'obj-123',
      '7'
    );
  });

  it('skips the job delete when the upload row has no object_id', async () => {
    const repo: IUploadRepository = {
      ...buildRepository(),
      findByKey: vi.fn().mockResolvedValue({
        id: 1,
        owner: 7,
        key: 'k.apkg',
        filename: 'k.apkg',
        object_id: null,
        size_mb: 1,
        created_at: new Date(),
      } as Uploads),
      deleteUpload: vi.fn().mockResolvedValue(1),
    };
    const jobRepository = {
      deleteJobByObjectId: vi.fn(),
    } as unknown as JobRepository;

    const service = new UploadService(
      repo,
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    await service.deleteUpload(7, 'k.apkg');

    expect(repo.deleteUpload).toHaveBeenCalledWith(7, 'k.apkg');
    expect(mockStorageDelete).toHaveBeenCalledWith('k.apkg');
    expect(jobRepository.deleteJobByObjectId).not.toHaveBeenCalled();
  });

  it('skips the job delete when no matching upload row exists', async () => {
    const repo: IUploadRepository = {
      ...buildRepository(),
      findByKey: vi.fn().mockResolvedValue(null),
      deleteUpload: vi.fn().mockResolvedValue(0),
    };
    const jobRepository = {
      deleteJobByObjectId: vi.fn(),
    } as unknown as JobRepository;

    const service = new UploadService(
      repo,
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    await service.deleteUpload(7, 'k.apkg');

    expect(jobRepository.deleteJobByObjectId).not.toHaveBeenCalled();
  });
});

describe('UploadService.promoteClaudeJobToUpload — async fs reads', () => {
  let tmpDir: string;

  beforeEach(() => {
    mockStorageUploadFile.mockClear();
    mockStorageUniqify.mockClear();
    MockGeneratePackagesUseCase.mockClear();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promote-claude-test-'));
    mockWorkspaceLocation = tmpDir;
    mockWorkspaceId = 'test-promote-id';
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads the apkg file and passes its contents to StorageHandler.uploadFile', async () => {
    const apkgContents = Buffer.from('fake-apkg-binary-contents');
    const apkgPath = path.join(tmpDir, 'my-deck.apkg');
    fs.writeFileSync(apkgPath, apkgContents);

    let resolveUpload!: () => void;
    const uploadCalled = new Promise<void>((r) => {
      resolveUpload = r;
    });
    mockStorageUploadFile.mockImplementationOnce(
      (_key: string, _buf: Buffer) => {
        resolveUpload();
        return Promise.resolve(undefined);
      }
    );

    const repo: IUploadRepository = {
      ...buildRepository(),
      update: vi.fn().mockResolvedValue([]),
    };
    const jobRepository = {
      create: vi.fn().mockResolvedValue(undefined),
      updateJobStatus: vi.fn().mockResolvedValue(undefined),
      findJobById: vi.fn().mockResolvedValue(null),
      deleteJob: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;

    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'my-deck',
              cardCount: 5,
              mcqCount: 0,
              mcqSkippedCount: 0,
            },
          ],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      repo,
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({ body: { 'claude-ai-flashcards': 'true' } });
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;

    await service.handleUpload(req, res);

    await uploadCalled;

    expect(mockStorageUploadFile).toHaveBeenCalledTimes(1);
    const [, uploadedBuffer] = mockStorageUploadFile.mock.calls[0] as [
      string,
      Buffer,
    ];
    expect(Buffer.compare(uploadedBuffer, apkgContents)).toBe(0);
  });

  it('emits conversion_succeeded so the async Claude path matches the sync funnel', async () => {
    fs.writeFileSync(path.join(tmpDir, 'my-deck.apkg'), Buffer.from('apkg'));

    let resolveFind!: () => void;
    const findCalled = new Promise<void>((r) => {
      resolveFind = r;
    });
    const repo: IUploadRepository = {
      ...buildRepository(),
      update: vi.fn().mockResolvedValue([]),
    };
    const jobRepository = {
      create: vi.fn().mockResolvedValue(undefined),
      updateJobStatus: vi.fn().mockResolvedValue(undefined),
      findJobById: vi.fn().mockImplementation(() => {
        resolveFind();
        return Promise.resolve(null);
      }),
      deleteJob: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;

    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [{ name: 'my-deck', cardCount: 7 }],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      repo,
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      body: { 'claude-ai-flashcards': 'true' },
      cookies: { anon_id: 'anon-async-1' },
    } as Partial<express.Request>);
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;

    await service.handleUpload(req, res);
    await findCalled;
    await new Promise((r) => setImmediate(r));

    expect(trackMock).toHaveBeenCalledWith(
      'conversion_started',
      expect.objectContaining({
        userId: 42,
        props: expect.objectContaining({ mode: 'async' }),
      })
    );
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.objectContaining({
        userId: 42,
        props: expect.objectContaining({ card_count_bucket: '3-49' }),
      })
    );
  });

  async function runAsyncUploadWithBody(
    body: Record<string, unknown>
  ): Promise<Mock> {
    fs.writeFileSync(path.join(tmpDir, 'my-deck.apkg'), Buffer.from('apkg'));

    let resolveUpdate!: () => void;
    const updateCalled = new Promise<void>((r) => {
      resolveUpdate = r;
    });
    const updateMock = vi.fn().mockImplementation(() => {
      resolveUpdate();
      return Promise.resolve([]);
    });
    const repo: IUploadRepository = {
      ...buildRepository(),
      update: updateMock,
    };
    const jobRepository = {
      create: vi.fn().mockResolvedValue(undefined),
      updateJobStatus: vi.fn().mockResolvedValue(undefined),
      findJobById: vi.fn().mockResolvedValue(null),
      deleteJob: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;

    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'my-deck',
              cardCount: 5,
              mcqCount: 0,
              mcqSkippedCount: 0,
            },
          ],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      repo,
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      body: { 'claude-ai-flashcards': 'true', ...body },
    });
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;

    await service.handleUpload(req, res);
    await updateCalled;
    return updateMock;
  }

  it('persists source=app on the async Claude upload insert', async () => {
    const updateMock = await runAsyncUploadWithBody({ source: 'app' });

    expect(updateMock).toHaveBeenCalledTimes(1);
    const args = updateMock.mock.calls[0];
    expect(args[0]).toBe(42);
    expect(args[4]).toBe('app');
  });

  it('persists null when the source is not on the allowlist', async () => {
    const updateMock = await runAsyncUploadWithBody({
      source: 'mobile-app-v2',
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][4]).toBeNull();
  });

  async function runAsyncUploadThatRejects(rejection: unknown): Promise<Mock> {
    let resolveFailed!: () => void;
    const failedRecorded = new Promise<void>((r) => {
      resolveFailed = r;
    });
    const updateJobStatusMock = vi
      .fn()
      .mockImplementation((_id: string, _owner: string, status: string) => {
        if (status === 'failed') {
          resolveFailed();
        }
        return Promise.resolve(undefined);
      });
    const jobRepository = {
      create: vi.fn().mockResolvedValue(undefined),
      updateJobStatus: updateJobStatusMock,
      findJobById: vi.fn().mockResolvedValue(null),
      deleteJob: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;

    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockRejectedValue(rejection),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({ body: { 'claude-ai-flashcards': 'true' } });
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;

    await service.handleUpload(req, res);
    await failedRecorded;
    return updateJobStatusMock;
  }

  it('records a non-empty failure reason when the worker rejects with an empty-message error', async () => {
    const updateJobStatusMock = await runAsyncUploadThatRejects(new Error(''));

    const failedCall = updateJobStatusMock.mock.calls.find(
      (call) => call[2] === 'failed'
    );
    expect(failedCall).toBeDefined();
    const reason = failedCall?.[3] as string;
    expect(typeof reason).toBe('string');
    expect(reason.trim()).not.toBe('');
  });

  it('records the designed empty-deck reason when the worker rejects with EmptyDeckError', async () => {
    const updateJobStatusMock = await runAsyncUploadThatRejects(
      new EmptyDeckError()
    );

    const failedCall = updateJobStatusMock.mock.calls.find(
      (call) => call[2] === 'failed'
    );
    expect(failedCall).toBeDefined();
    expect(failedCall?.[3]).toMatch(/^No cards in this deck yet\./);
  });

  it('marks a Claude job failed with the empty-deck reason when the only package has 0 cards', async () => {
    let resolveFailed!: () => void;
    const failedRecorded = new Promise<void>((r) => {
      resolveFailed = r;
    });
    const updateJobStatusMock = vi
      .fn()
      .mockImplementation((_id: string, _owner: string, status: string) => {
        if (status === 'failed') {
          resolveFailed();
        }
        return Promise.resolve(undefined);
      });
    const jobRepository = {
      create: vi.fn().mockResolvedValue(undefined),
      updateJobStatus: updateJobStatusMock,
      findJobById: vi.fn().mockResolvedValue(null),
      deleteJob: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;
    const updateSpy = vi.fn().mockResolvedValue([]);
    const repo: IUploadRepository = {
      ...buildRepository(),
      update: updateSpy,
    };

    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'my-deck',
              cardCount: 0,
              mcqCount: 0,
              mcqSkippedCount: 0,
            },
          ],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      repo,
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({ body: { 'claude-ai-flashcards': 'true' } });
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;

    await service.handleUpload(req, res);
    await failedRecorded;

    const failedCall = updateJobStatusMock.mock.calls.find(
      (call) => call[2] === 'failed'
    );
    expect(failedCall).toBeDefined();
    expect(failedCall?.[3]).toMatch(/^No cards in this deck yet\./);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('UploadService.handleUpload — multi-deck batch', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  let workspaceDir = '';

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-batch');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    trackMock.mockClear();
    mockWorkspaceId = 'batch-ws-id';
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-ws-'));
    mockWorkspaceLocation = workspaceDir;
    fs.writeFileSync(path.join(workspaceDir, 'Biology 101.apkg'), 'deck-a');
    fs.writeFileSync(path.join(workspaceDir, 'Chemistry.apkg'), 'deck-b');
    fs.writeFileSync(path.join(workspaceDir, 'index.html'), '<html></html>');
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('returns 200 JSON listing every deck instead of redirecting to /download', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'Biology 101',
              cardCount: 3,
              mcqCount: 0,
              mcqSkippedCount: 0,
            },
            {
              name: 'Chemistry',
              cardCount: 5,
              mcqCount: 0,
              mcqSkippedCount: 0,
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(res.redirect).not.toHaveBeenCalled();
    expect(capturedStatus()).toBe(200);

    const body = capturedJson() as {
      kind: string;
      workspaceId: string;
      deckCount: number;
      decks: { name: string; filename: string; downloadUrl: string }[];
      bulkUrl: string;
    };
    expect(body.kind).toBe('batch');
    expect(body.workspaceId).toBe('batch-ws-id');
    expect(body.deckCount).toBe(2);
    expect(body.bulkUrl).toBe('/download/batch-ws-id/bulk');
    expect(body.decks).toHaveLength(2);

    const names = body.decks.map((d) => d.name).sort();
    expect(names).toEqual(['Biology 101', 'Chemistry']);
    const chemistry = body.decks.find((d) => d.name === 'Chemistry')!;
    expect(chemistry.filename).toBe('Chemistry.apkg');
    expect(chemistry.downloadUrl).toBe('/download/batch-ws-id/Chemistry.apkg');

    const biology = body.decks.find((d) => d.name === 'Biology 101')!;
    expect(biology.downloadUrl).toBe(
      '/download/batch-ws-id/Biology%20101.apkg'
    );

    expect(trackMock).toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.objectContaining({
        props: expect.objectContaining({ source: 'upload' }),
      })
    );
  });

  it('includes droppedImageCount in the batch JSON when images were dropped across the batch', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'Biology 101',
              cardCount: 3,
              mcqCount: 0,
              mcqSkippedCount: 0,
              droppedImageCount: 1,
            },
            {
              name: 'Chemistry',
              cardCount: 5,
              mcqCount: 0,
              mcqSkippedCount: 0,
              droppedImageCount: 2,
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    const body = capturedJson() as { droppedImageCount?: number };
    expect(body.droppedImageCount).toBe(3);
  });

  it('omits droppedImageCount from the batch JSON when no images were dropped', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'Biology 101',
              cardCount: 3,
              mcqCount: 0,
              mcqSkippedCount: 0,
            },
            {
              name: 'Chemistry',
              cardCount: 5,
              mcqCount: 0,
              mcqSkippedCount: 0,
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    const body = capturedJson() as { droppedImageCount?: number };
    expect(body.droppedImageCount).toBeUndefined();
  });

  it('includes expiredNotionImageCount in the batch JSON when Notion images expired across the batch', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'Biology 101',
              cardCount: 3,
              mcqCount: 0,
              mcqSkippedCount: 0,
              droppedImageCount: 1,
              expiredNotionImageCount: 1,
            },
            {
              name: 'Chemistry',
              cardCount: 5,
              mcqCount: 0,
              mcqSkippedCount: 0,
              droppedImageCount: 2,
              expiredNotionImageCount: 2,
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    const body = capturedJson() as { expiredNotionImageCount?: number };
    expect(body.expiredNotionImageCount).toBe(3);
  });

  it('omits expiredNotionImageCount from the batch JSON when no Notion images expired', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [
            {
              name: 'Biology 101',
              cardCount: 3,
              mcqCount: 0,
              mcqSkippedCount: 0,
            },
            {
              name: 'Chemistry',
              cardCount: 5,
              mcqCount: 0,
              mcqSkippedCount: 0,
            },
          ],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    const body = capturedJson() as { expiredNotionImageCount?: number };
    expect(body.expiredNotionImageCount).toBeUndefined();
  });
});

describe('UploadService.restartClaudeJob — concurrent restart guard', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  let db: Knex;
  let workspaceBase: string;
  let resolveDeckInfo: (() => void) | null = null;

  beforeAll(() => {
    workspaceBase = fs.mkdtempSync(
      path.join(os.tmpdir(), 'restart-guard-base-')
    );
    process.env.WORKSPACE_BASE = workspaceBase;
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
    fs.rmSync(workspaceBase, { recursive: true, force: true });
  });

  beforeEach(async () => {
    mockGenerateDeckInfo.mockReset();
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('jobs', (t) => {
      t.increments('id');
      t.string('owner').notNullable();
      t.string('object_id').notNullable();
      t.string('title');
      t.string('type');
      t.string('status');
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('last_edited_time');
      t.string('job_reason_failure');
      t.integer('card_count');
    });
    const workspaceDir = path.join(workspaceBase, 'job-obj-1');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'page.html'),
      '<html><body>Q/A</body></html>'
    );
  });

  afterEach(async () => {
    resolveDeckInfo = null;
    await db.destroy();
  });

  function buildRestartRequest() {
    return {
      params: { jobId: 'job-obj-1' },
      body: {},
    } as unknown as express.Request;
  }

  it('fires exactly one worker when two restart requests race on the same done job', async () => {
    await db('jobs').insert({
      owner: '42',
      object_id: 'job-obj-1',
      title: 'Deck',
      type: 'claude',
      status: 'done',
      last_edited_time: new Date(),
    });

    const deckInfoStarted = new Promise<void>((started) => {
      mockGenerateDeckInfo.mockImplementation(() => {
        started();
        return new Promise(() => {
          resolveDeckInfo = () => undefined;
        });
      });
    });

    const repo = buildRepository();
    const jobRepository = new JobRepository(db);
    const service = new UploadService(
      repo,
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );

    const firstResponse = buildResponse();
    (firstResponse.res.locals as Record<string, unknown>).owner = 42;
    const secondResponse = buildResponse();
    (secondResponse.res.locals as Record<string, unknown>).owner = 42;

    await Promise.all([
      service.restartClaudeJob(buildRestartRequest(), firstResponse.res),
      service.restartClaudeJob(buildRestartRequest(), secondResponse.res),
    ]);

    await deckInfoStarted;

    expect(mockGenerateDeckInfo).toHaveBeenCalledTimes(1);

    const statuses = [
      firstResponse.capturedStatus(),
      secondResponse.capturedStatus(),
    ];
    expect(statuses).toContain(202);
    expect(statuses).toContain(409);
  });

  it('does not fire a worker when the job is already in flight (non-terminal status)', async () => {
    await db('jobs').insert({
      owner: '42',
      object_id: 'job-obj-1',
      title: 'Deck',
      type: 'claude',
      status: 'step1_started',
      last_edited_time: new Date(),
    });

    const repo = buildRepository();
    const jobRepository = new JobRepository(db);
    const service = new UploadService(
      repo,
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );

    const { res, capturedStatus, capturedJson } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.restartClaudeJob(buildRestartRequest(), res);

    expect(mockGenerateDeckInfo).not.toHaveBeenCalled();
    expect(capturedStatus()).toBe(409);
    expect(capturedJson()).toMatchObject({ code: 'already_running' });
  });

  it('409s workspace_gone when the fallback marker names images that no longer exist', async () => {
    await db('jobs').insert({
      owner: '42',
      object_id: 'job-obj-1',
      title: 'Deck',
      type: 'claude',
      status: 'failed',
      last_edited_time: new Date(),
    });
    const workspaceDir = path.join(workspaceBase, 'job-obj-1');
    writePdfImageFallbackMarker(workspaceDir, ['page.html']);

    const repo = buildRepository();
    const jobRepository = new JobRepository(db);
    const service = new UploadService(
      repo,
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );

    const { res, capturedStatus, capturedJson } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.restartClaudeJob(buildRestartRequest(), res);

    expect(mockGenerateDeckInfo).not.toHaveBeenCalled();
    expect(capturedStatus()).toBe(409);
    expect(capturedJson()).toMatchObject({ code: 'workspace_gone' });
  });

  it('restarts a fallback job normally while its page images are still on disk', async () => {
    await db('jobs').insert({
      owner: '42',
      object_id: 'job-obj-1',
      title: 'Deck',
      type: 'claude',
      status: 'failed',
      last_edited_time: new Date(),
    });
    const workspaceDir = path.join(workspaceBase, 'job-obj-1');
    writePdfImageFallbackMarker(workspaceDir, ['page.html']);
    const imagesDir = path.join(workspaceDir, 'pdf-abc');
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(path.join(imagesDir, 'page-1.png'), Buffer.from('png'));
    // Park the background restart on a pending promise (same pattern as the
    // race test above): letting it run to completion leaks a late
    // generateDeckInfo call into whichever describe runs next.
    const generateStarted = new Promise<void>((resolve) => {
      mockGenerateDeckInfo.mockImplementation(() => {
        resolve();
        return new Promise(() => {});
      });
    });

    const repo = buildRepository();
    const jobRepository = new JobRepository(db);
    const service = new UploadService(
      repo,
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );

    const { res, capturedStatus } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.restartClaudeJob(buildRestartRequest(), res);
    await generateStarted;

    expect(capturedStatus()).toBe(202);
  });

  it('409s workspace_gone when the workspace directory is missing entirely', async () => {
    await db('jobs').insert({
      owner: '42',
      object_id: 'job-obj-2',
      title: 'Deck',
      type: 'claude',
      status: 'failed',
      last_edited_time: new Date(),
    });

    const repo = buildRepository();
    const jobRepository = new JobRepository(db);
    const service = new UploadService(
      repo,
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );

    const { res, capturedStatus, capturedJson } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.restartClaudeJob(
      {
        params: { jobId: 'job-obj-2' },
        body: {},
      } as unknown as express.Request,
      res
    );

    expect(capturedStatus()).toBe(409);
    expect(capturedJson()).toMatchObject({ code: 'workspace_gone' });
  });
});

describe('UploadService.restartClaudeJob — replays original conversion settings', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  let db: Knex;
  let workspaceBase: string;

  beforeAll(() => {
    workspaceBase = fs.mkdtempSync(
      path.join(os.tmpdir(), 'restart-settings-base-')
    );
    process.env.WORKSPACE_BASE = workspaceBase;
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
    fs.rmSync(workspaceBase, { recursive: true, force: true });
  });

  beforeEach(async () => {
    mockGenerateDeckInfo.mockReset();
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('jobs', (t) => {
      t.increments('id');
      t.string('owner').notNullable();
      t.string('object_id').notNullable();
      t.string('title');
      t.string('type');
      t.string('status');
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('last_edited_time');
      t.string('job_reason_failure');
      t.integer('card_count');
    });
    fs.rmSync(path.join(workspaceBase, 'job-obj-settings'), {
      recursive: true,
      force: true,
    });
    const workspaceDir = path.join(workspaceBase, 'job-obj-settings');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'page.html'),
      '<html><body>Q/A</body></html>'
    );
  });

  afterEach(async () => {
    await db.destroy();
  });

  function buildRestartRequest() {
    return {
      params: { jobId: 'job-obj-settings' },
      body: {},
    } as unknown as express.Request;
  }

  async function insertDoneJob() {
    await db('jobs').insert({
      owner: '42',
      object_id: 'job-obj-settings',
      title: 'Deck',
      type: 'claude',
      status: 'done',
      last_edited_time: new Date(),
    });
  }

  async function restartAndWaitForGenerate(): Promise<unknown[]> {
    const service = new UploadService(
      buildRepository(),
      new JobRepository(db),
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const generateCalled = new Promise<unknown[]>((resolve) => {
      mockGenerateDeckInfo.mockImplementation((...args: unknown[]) => {
        resolve(args);
        return new Promise(() => {});
      });
    });
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;
    await service.restartClaudeJob(buildRestartRequest(), res);
    return generateCalled;
  }

  it('replays persisted instructions, card size, and comprehensive option', async () => {
    await insertDoneJob();
    fs.writeFileSync(
      path.join(workspaceBase, 'job-obj-settings', 'conversion-settings.json'),
      JSON.stringify({
        'user-instructions': 'Summarize each slide into one dense card',
        'card-size': 'detailed',
        'ai-comprehensive': 'true',
      })
    );

    const args = await restartAndWaitForGenerate();

    expect(args[0]).toBe('<html><body>Q/A</body></html>');
    expect(args[2]).toBe('Summarize each slide into one dense card');
    expect(args[5]).toBe('detailed');
    expect(args[7]).toMatchObject({
      isPaying: true,
      userId: 42,
      comprehensive: true,
    });
  });

  it("rebuilds the restarted AI deck with the user's template and note types", async () => {
    await insertDoneJob();
    fs.writeFileSync(
      path.join(workspaceBase, 'job-obj-settings', 'conversion-settings.json'),
      JSON.stringify({
        template: 'notionstyle',
        basic_model_name: 'My Basic',
        cloze_model_name: 'My Cloze',
      })
    );
    mockGenerateDeckInfo.mockResolvedValue([
      {
        name: 'Deck',
        image: '',
        style: null,
        id: 1,
        settings: {
          template: 'specialstyle',
          basicModelName: 'n2a-basic',
          clozeModelName: 'n2a-cloze',
          inputModelName: 'n2a-input',
          useNotionId: true,
        },
        cards: [{ name: 'q', back: 'a', tags: [], cloze: false, media: [] }],
      },
    ]);
    const exporterMock = vi.mocked(CustomExporter);
    exporterMock.mockClear();

    const service = new UploadService(
      buildRepository(),
      new JobRepository(db),
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;
    await service.restartClaudeJob(buildRestartRequest(), res);
    for (let i = 0; i < 200 && exporterMock.mock.results.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const configure = (
      exporterMock.mock.results[0].value as { configure: Mock }
    ).configure;
    for (let i = 0; i < 200 && configure.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }

    const [decks] = configure.mock.calls[0] as [
      Array<{ settings: Record<string, unknown> }>,
    ];
    expect(decks[0].settings).toMatchObject({
      template: 'notionstyle',
      basicModelName: 'My Basic',
      clozeModelName: 'My Cloze',
      inputModelName: 'n2a-input',
      useNotionId: true,
    });
  });

  it("attaches the user's saved custom templates to a restarted AI deck", async () => {
    await insertDoneJob();
    fs.writeFileSync(
      path.join(workspaceBase, 'job-obj-settings', 'conversion-settings.json'),
      JSON.stringify({ template: 'custom', basic_model_name: 'My Basic' })
    );
    mockGenerateDeckInfo.mockResolvedValue([
      {
        name: 'Deck',
        image: '',
        style: null,
        id: 1,
        settings: { template: 'specialstyle', basicModelName: 'n2a-basic' },
        cards: [{ name: 'q', back: 'a', tags: [], cloze: false, media: [] }],
      },
    ]);
    const customBasic = {
      parent: 'n2a-basic',
      name: 'My Basic',
      front: '<b>{{Front}}</b>',
      back: '{{Back}}',
      styling: '.card { color: teal; }',
      storageKey: 'n2a-basic',
    };
    const attachCustomTemplates = vi.fn(
      async (_owner: string, settings: { n2aBasic?: unknown }) => {
        settings.n2aBasic = customBasic;
      }
    );
    const exporterMock = vi.mocked(CustomExporter);
    exporterMock.mockClear();

    const service = new UploadService(
      buildRepository(),
      new JobRepository(db),
      buildUsersRepo(),
      ...fakeUploadServiceDeps({
        settings: {
          attachCustomTemplates,
        } as unknown as ISettingsRepository,
      })
    );
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;
    await service.restartClaudeJob(buildRestartRequest(), res);
    for (let i = 0; i < 200 && exporterMock.mock.results.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const configure = (
      exporterMock.mock.results[0].value as { configure: Mock }
    ).configure;
    for (let i = 0; i < 200 && configure.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(attachCustomTemplates).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ template: 'custom' })
    );
    const [decks] = configure.mock.calls[0] as [
      Array<{ settings: Record<string, unknown> }>,
    ];
    expect(decks[0].settings).toMatchObject({
      template: 'custom',
      basicModelName: 'My Basic',
      n2aBasic: customBasic,
    });
  });

  it('does not treat the persisted settings file as a media file', async () => {
    await insertDoneJob();
    fs.writeFileSync(
      path.join(workspaceBase, 'job-obj-settings', 'conversion-settings.json'),
      JSON.stringify({ 'card-size': 'short' })
    );

    const args = await restartAndWaitForGenerate();

    expect(args[1]).toEqual([]);
  });

  it('restarts with defaults when no settings file was persisted', async () => {
    await insertDoneJob();

    const args = await restartAndWaitForGenerate();

    expect(args[0]).toBe('<html><body>Q/A</body></html>');
    expect(args[2]).toBeUndefined();
    expect(args[7]).toMatchObject({ isPaying: true, userId: 42 });
  });

  it('restarts with defaults when the settings file is corrupt', async () => {
    await insertDoneJob();
    fs.writeFileSync(
      path.join(workspaceBase, 'job-obj-settings', 'conversion-settings.json'),
      'not json {'
    );

    const args = await restartAndWaitForGenerate();

    expect(args[0]).toBe('<html><body>Q/A</body></html>');
    expect(args[2]).toBeUndefined();
  });
});

describe('UploadService.restartClaudeJob — a saved PowerPoint conversion', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  const jobId = 'job-obj-pptx';
  let db: Knex;
  let workspaceBase: string;

  function slideUnit(overrides: Partial<SlideUnit>): SlideUnit {
    return {
      id: 'slide-1',
      visibleText: '',
      speakerNotes: '',
      role: 'body',
      title: '',
      paragraphs: [],
      chromeParagraphs: [],
      textWithChrome: [],
      hasPicture: false,
      ...overrides,
    };
  }

  beforeAll(() => {
    workspaceBase = fs.mkdtempSync(
      path.join(os.tmpdir(), 'restart-pptx-base-')
    );
    process.env.WORKSPACE_BASE = workspaceBase;
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
    fs.rmSync(workspaceBase, { recursive: true, force: true });
  });

  beforeEach(async () => {
    mockGenerateDeckInfo.mockReset();
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('jobs', (t) => {
      t.increments('id');
      t.string('owner').notNullable();
      t.string('object_id').notNullable();
      t.string('title');
      t.string('type');
      t.string('status');
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('last_edited_time');
      t.string('job_reason_failure');
      t.integer('card_count');
    });
    const workspaceDir = path.join(workspaceBase, jobId);
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(workspaceDir, 'pdf-1'), { recursive: true });
    const pages = [1, 2].map((n) =>
      path.join(workspaceDir, 'pdf-1', `Lecture%203.pdf-page${n}-${n}.png`)
    );
    for (const page of pages) fs.writeFileSync(page, 'png');
    fs.writeFileSync(
      path.join(workspaceDir, 'Lecture%203.pptx.html'),
      combineSlidesIntoHTML(
        [
          slideUnit({ title: 'Mitosis', paragraphs: ['Prophase'] }),
          slideUnit({
            id: 'slide-2',
            role: 'image',
            hasPicture: true,
            chromeParagraphs: ['Cell Biology', '2'],
          }),
        ],
        pages,
        'Lecture%203.pdf',
        workspaceDir
      )
    );
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('hands Claude saved slide image srcs that decode to the media files it offers', async () => {
    await db('jobs').insert({
      owner: '42',
      object_id: jobId,
      title: 'Deck',
      type: 'claude',
      status: 'done',
      last_edited_time: new Date(),
    });
    const service = new UploadService(
      buildRepository(),
      new JobRepository(db),
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const generateCalled = new Promise<unknown[]>((resolve) => {
      mockGenerateDeckInfo.mockImplementation((...args: unknown[]) => {
        resolve(args);
        return new Promise(() => {});
      });
    });
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;

    await service.restartClaudeJob(
      { params: { jobId }, body: {} } as unknown as express.Request,
      res
    );
    const [html, mediaFiles] = (await generateCalled) as [string, string[]];

    const srcs = [...html.matchAll(/<img src="([^"]+)"/g)].map((match) =>
      decodeURIComponent(match[1])
    );
    expect(srcs).toEqual([
      'pdf-1/Lecture%203.pdf-page1-1.png',
      'pdf-1/Lecture%203.pdf-page2-2.png',
    ]);
    expect(mediaFiles).toEqual(expect.arrayContaining(srcs));
  });
});

describe('UploadService.restartClaudeJob — replays the PDF-image-fallback flag', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  let db: Knex;
  let workspaceBase: string;

  beforeAll(() => {
    workspaceBase = fs.mkdtempSync(
      path.join(os.tmpdir(), 'restart-fallback-base-')
    );
    process.env.WORKSPACE_BASE = workspaceBase;
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
    fs.rmSync(workspaceBase, { recursive: true, force: true });
  });

  beforeEach(async () => {
    mockGenerateDeckInfo.mockReset();
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('jobs', (t) => {
      t.increments('id');
      t.string('owner').notNullable();
      t.string('object_id').notNullable();
      t.string('title');
      t.string('type');
      t.string('status');
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('last_edited_time');
      t.string('job_reason_failure');
      t.integer('card_count');
    });
    fs.rmSync(path.join(workspaceBase, 'job-obj-fallback'), {
      recursive: true,
      force: true,
    });
    const workspaceDir = path.join(workspaceBase, 'job-obj-fallback');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'scan.pdf.html'),
      '<html><body><img src="scan.pdf/page-1.png" /></body></html>'
    );
    const pageImagesDir = path.join(workspaceDir, 'scan.pdf');
    fs.mkdirSync(pageImagesDir, { recursive: true });
    fs.writeFileSync(
      path.join(pageImagesDir, 'page-1.png'),
      Buffer.from('png')
    );
  });

  afterEach(async () => {
    await db.destroy();
  });

  function buildRestartRequest() {
    return {
      params: { jobId: 'job-obj-fallback' },
      body: {},
    } as unknown as express.Request;
  }

  async function insertDoneJob() {
    await db('jobs').insert({
      owner: '42',
      object_id: 'job-obj-fallback',
      title: 'Deck',
      type: 'claude',
      status: 'done',
      last_edited_time: new Date(),
    });
  }

  async function restartAndWaitForGenerate(): Promise<unknown[]> {
    const service = new UploadService(
      buildRepository(),
      new JobRepository(db),
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const generateCalled = new Promise<unknown[]>((resolve) => {
      mockGenerateDeckInfo.mockImplementation((...args: unknown[]) => {
        resolve(args);
        return new Promise(() => {});
      });
    });
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;
    await service.restartClaudeJob(buildRestartRequest(), res);
    return generateCalled;
  }

  it('passes pdfImageFallback for a file listed in the fallback marker', async () => {
    await insertDoneJob();
    fs.writeFileSync(
      path.join(workspaceBase, 'job-obj-fallback', 'conversion-fallback.json'),
      JSON.stringify(['scan.pdf.html'])
    );

    const args = await restartAndWaitForGenerate();

    expect(args[7]).toMatchObject({
      isPaying: true,
      userId: 42,
      pdfImageFallback: {
        mediaBaseDir: path.join(workspaceBase, 'job-obj-fallback'),
      },
    });
  });

  it('attaches page images by default when no embed-images preference is persisted', async () => {
    await insertDoneJob();
    fs.writeFileSync(
      path.join(workspaceBase, 'job-obj-fallback', 'conversion-fallback.json'),
      JSON.stringify(['scan.pdf.html'])
    );

    const args = await restartAndWaitForGenerate();

    expect(
      (args[7] as { pdfImageFallback: { attachPageImages: boolean } })
        .pdfImageFallback.attachPageImages
    ).toBe(true);
  });

  it('omits page images when persisted settings turn embed-images off', async () => {
    await insertDoneJob();
    fs.writeFileSync(
      path.join(workspaceBase, 'job-obj-fallback', 'conversion-fallback.json'),
      JSON.stringify(['scan.pdf.html'])
    );
    fs.writeFileSync(
      path.join(workspaceBase, 'job-obj-fallback', 'conversion-settings.json'),
      JSON.stringify({ 'embed-images': 'false' })
    );

    const args = await restartAndWaitForGenerate();

    expect(
      (args[7] as { pdfImageFallback: { attachPageImages: boolean } })
        .pdfImageFallback.attachPageImages
    ).toBe(false);
  });

  it('does not pass pdfImageFallback when no marker was persisted', async () => {
    await insertDoneJob();

    const args = await restartAndWaitForGenerate();

    expect(
      (args[7] as { pdfImageFallback?: unknown }).pdfImageFallback
    ).toBeUndefined();
  });

  it('does not pass pdfImageFallback when the marker is corrupt', async () => {
    await insertDoneJob();
    fs.writeFileSync(
      path.join(workspaceBase, 'job-obj-fallback', 'conversion-fallback.json'),
      'not json {'
    );

    const args = await restartAndWaitForGenerate();

    expect(
      (args[7] as { pdfImageFallback?: unknown }).pdfImageFallback
    ).toBeUndefined();
  });

  it('does not treat the fallback marker file as a media file', async () => {
    await insertDoneJob();
    fs.writeFileSync(
      path.join(workspaceBase, 'job-obj-fallback', 'conversion-fallback.json'),
      JSON.stringify(['scan.pdf.html'])
    );

    const args = await restartAndWaitForGenerate();

    // Workspace-relative, matching the HTML's <img src="scan.pdf/page-1.png">.
    // The bare basename this used to assert could never match that nested src
    // on the non-fallback resolution path; the marker file stays excluded.
    expect(args[1]).toEqual(['scan.pdf/page-1.png']);
  });
});

describe('UploadService.handleUpload — claude flag does not bypass the card limit', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    trackMock.mockClear();
    mockFirstApkg = Buffer.from('fake-apkg');
    mockWorkspaceId = 'test-ws-id';
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [{ name: 'deck', cardCount: 30 }],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });
  });

  function buildJobRepo(): { repo: JobRepository; create: Mock } {
    const create = vi.fn().mockResolvedValue(undefined);
    return {
      repo: {
        create,
        updateJobStatus: vi.fn().mockResolvedValue(undefined),
        findJobById: vi.fn().mockResolvedValue(null),
        deleteJob: vi.fn().mockResolvedValue(undefined),
      } as unknown as JobRepository,
      create,
    };
  }

  it('routes a free user with the claude flag through the sync path and enforces the limit', async () => {
    const usersRepo = buildUsersRepo({
      getCardUsage: vi
        .fn()
        .mockResolvedValue({ cards_used: 80, month_started_at: new Date() }),
    });
    const incrementSpy = usersRepo.incrementCardUsage as Mock;
    const { repo: jobRepo, create } = buildJobRepo();

    const service = new UploadService(
      buildRepository(),
      jobRepo,
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({ body: { 'claude-ai-flashcards': 'true' } });
    const built = buildResponse();
    let redirectedTo: string | null = null;
    (built.res.redirect as unknown as Mock).mockImplementation(
      (url: string) => {
        redirectedTo = url;
        return built.res;
      }
    );
    (built.res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, built.res);

    expect(create).not.toHaveBeenCalled();
    expect(built.capturedStatus()).not.toBe(202);
    expect(redirectedTo).toBe('/limit?kind=card_count');
    expect(incrementSpy).not.toHaveBeenCalled();
  });

  it('serves a free user with the claude flag a sync deck when under the limit', async () => {
    const usersRepo = buildUsersRepo({
      getCardUsage: vi
        .fn()
        .mockResolvedValue({ cards_used: 10, month_started_at: new Date() }),
    });
    const incrementSpy = usersRepo.incrementCardUsage as Mock;
    const { repo: jobRepo, create } = buildJobRepo();

    const service = new UploadService(
      buildRepository(),
      jobRepo,
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({ body: { 'claude-ai-flashcards': 'true' } });
    const { res, capturedStatus, capturedSend } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(create).not.toHaveBeenCalled();
    expect(capturedStatus()).toBe(200);
    expect(capturedSend()).not.toBeNull();
    expect(incrementSpy).toHaveBeenCalledWith(42, 30);
  });

  it('keeps the async path for a paying user with the claude flag', async () => {
    const usersRepo = buildUsersRepo();
    const { repo: jobRepo, create } = buildJobRepo();

    const service = new UploadService(
      buildRepository(),
      jobRepo,
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({ body: { 'claude-ai-flashcards': 'true' } });
    const { res, capturedStatus, capturedJson } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;

    await service.handleUpload(req, res);

    expect(create).toHaveBeenCalled();
    expect(capturedStatus()).toBe(202);
    expect(capturedJson()).toEqual({ jobId: 'test-ws-id' });
  });

  it('persists the conversion settings body into the workspace for restarts', async () => {
    const previousLocation = mockWorkspaceLocation;
    mockWorkspaceLocation = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ws-settings-persist-')
    );
    try {
      const usersRepo = buildUsersRepo();
      const { repo: jobRepo } = buildJobRepo();

      const service = new UploadService(
        buildRepository(),
        jobRepo,
        usersRepo,
        ...fakeUploadServiceDeps()
      );
      const req = buildRequest({
        body: {
          'claude-ai-flashcards': 'true',
          'user-instructions': 'Summarize each slide into one dense card',
          'card-size': 'detailed',
          'ai-comprehensive': 'true',
        },
      });
      const { res, capturedStatus } = buildResponse();
      (res.locals as Record<string, unknown>).owner = 42;
      (res.locals as Record<string, unknown>).subscriber = true;

      await service.handleUpload(req, res);

      expect(capturedStatus()).toBe(202);
      const saved = JSON.parse(
        fs.readFileSync(
          path.join(mockWorkspaceLocation, 'conversion-settings.json'),
          'utf8'
        )
      );
      expect(saved).toMatchObject({
        'user-instructions': 'Summarize each slide into one dense card',
        'card-size': 'detailed',
        'ai-comprehensive': 'true',
      });
    } finally {
      fs.rmSync(mockWorkspaceLocation, { recursive: true, force: true });
      mockWorkspaceLocation = previousLocation;
    }
  });
});

describe('UploadService.handleUpload — a PDF from a pass holder without an account', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    trackMock.mockClear();
    mockGenerateAiPreview.mockReset();
    // Every flag on, the AI preview included: only the pass keeps it away.
    mockGetFeatureFlag.mockResolvedValue(true);
    mockFirstApkg = Buffer.from('fake-apkg');
    mockWorkspaceId = 'test-ws-id';
  });

  function passHolderPdfUpload(execute: Mock, body: Record<string, string>) {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return { execute } as unknown as InstanceType<
        typeof GeneratePackagesUseCase
      >;
    });
    const create = vi.fn().mockResolvedValue(undefined);
    const service = new UploadService(
      buildRepository(),
      { create } as unknown as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [
        {
          originalname: 'slides.pdf',
          mimetype: 'application/pdf',
          size: 2048,
          path: '/tmp/slides.pdf',
          buffer: Buffer.from('%PDF-1.4 slides'),
        },
      ],
      body,
      headers: { 'x-pass-token': 'cs_pass' },
      cookies: { anon_id: 'visitor-with-pass' },
    } as unknown as Partial<express.Request>);
    const built = buildResponse();
    Object.assign(built.res.locals, { subscriber: true, anonymousPassId: 31 });
    return { service, req, create, ...built };
  }

  it('asks about the PDF on the sync path, with no job and no AI preview', async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(
        new Error(
          buildPdfFallbackChoiceSentinel({ reason: 'no_text', pageCount: 12 })
        )
      );
    const { service, req, res, create, capturedStatus, capturedJson } =
      passHolderPdfUpload(execute, {
        'claude-ai-flashcards': 'true',
        'pdf-fallback': 'ask',
      });

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(409);
    expect(capturedJson()).toEqual({
      code: 'choose_pdf_mode',
      reason: 'no_text',
      page_count: 12,
    });
    const [paying, , settings] = execute.mock.calls[0];
    expect(paying).toBe(true);
    expect(settings.claudeAIFlashcards).toBe(true);
    expect(settings.pdfFallback).toBe('ask');
    expect(create).not.toHaveBeenCalled();
    expect(mockGetFeatureFlag).not.toHaveBeenCalledWith(
      ANONYMOUS_AI_PREVIEW_FLAG,
      expect.anything()
    );
    expect(mockGenerateAiPreview).not.toHaveBeenCalled();
  });

  it.each([
    {
      deck: 'a deck Claude wrote, AI on',
      ai: 'true',
      pdfFallbackMode: undefined,
    },
    {
      deck: 'a page-image deck, AI off',
      ai: 'false',
      pdfFallbackMode: 'pairs',
    },
  ])(
    'sends X-Pdf-Fallback only with a page-image mode: $deck',
    async ({ ai, pdfFallbackMode }) => {
      const execute = vi.fn().mockResolvedValue({
        packages: [{ name: 'slides', cardCount: 7, pdfFallbackMode }],
        warnings: [],
      });
      const { service, req, res, create, capturedStatus } = passHolderPdfUpload(
        execute,
        {
          'claude-ai-flashcards': ai,
          'pdf-fallback': 'pairs',
        }
      );

      await service.handleUpload(req, res);

      expect(capturedStatus()).toBe(200);
      expect(create).not.toHaveBeenCalled();
      const sent = (res.set as Mock).mock.calls.find(
        ([name]) => name === 'X-Pdf-Fallback'
      );
      expect(sent?.[1]).toBe(pdfFallbackMode);
    }
  );

  it('answers 400 empty_content when Claude makes no cards from the page images', async () => {
    const execute = vi.fn().mockRejectedValue(
      Object.assign(new Error(EMPTY_CONTENT_UPLOAD_MESSAGE), {
        name: 'EmptyContentError',
      })
    );
    const { service, req, res, capturedStatus, capturedJson } =
      passHolderPdfUpload(execute, {
        'claude-ai-flashcards': 'true',
        'pdf-fallback': 'pairs',
      });

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect(capturedJson()).toEqual({
      code: 'empty_content',
      message: EMPTY_CONTENT_UPLOAD_MESSAGE,
    });
  });
});

describe('UploadService.restartClaudeJob — card-limit enforcement', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  let db: Knex;
  let workspaceBase: string;

  beforeAll(() => {
    workspaceBase = fs.mkdtempSync(
      path.join(os.tmpdir(), 'restart-limit-base-')
    );
    process.env.WORKSPACE_BASE = workspaceBase;
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
    fs.rmSync(workspaceBase, { recursive: true, force: true });
  });

  beforeEach(async () => {
    mockGenerateDeckInfo.mockReset();
    mockStorageUploadFile.mockClear();
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('jobs', (t) => {
      t.increments('id');
      t.string('owner').notNullable();
      t.string('object_id').notNullable();
      t.string('title');
      t.string('type');
      t.string('status');
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('last_edited_time');
      t.string('job_reason_failure');
      t.integer('card_count');
    });
    const workspaceDir = path.join(workspaceBase, 'job-obj-limit');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'page.html'),
      '<html><body>Q/A</body></html>'
    );
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function waitForFailedJob(): Promise<{
    status: string;
    job_reason_failure: string;
  }> {
    for (let i = 0; i < 200; i++) {
      const row = await db('jobs')
        .where({ object_id: 'job-obj-limit' })
        .first();
      if (row?.status === 'failed') {
        return row as { status: string; job_reason_failure: string };
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('job never reached failed status');
  }

  it('fails a free user restart over the monthly limit with a monthly_limit reason and no delivery', async () => {
    await db('jobs').insert({
      owner: '42',
      object_id: 'job-obj-limit',
      title: 'Deck',
      type: 'claude',
      status: 'done',
      last_edited_time: new Date(),
    });
    mockGenerateDeckInfo.mockResolvedValue([
      {
        name: 'Deck',
        cards: new Array(150).fill({ front: 'q', back: 'a' }),
      },
    ]);
    const usersRepo = buildUsersRepo({
      getCardUsage: vi
        .fn()
        .mockResolvedValue({ cards_used: 80, month_started_at: new Date() }),
    });
    const incrementSpy = usersRepo.incrementCardUsage as Mock;

    const service = new UploadService(
      buildRepository(),
      new JobRepository(db),
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = {
      params: { jobId: 'job-obj-limit' },
      body: {},
    } as unknown as express.Request;
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.restartClaudeJob(req, res);

    const failed = await waitForFailedJob();
    const reason = JSON.parse(failed.job_reason_failure) as {
      code: string;
      cards_used: number;
      limit: number;
    };
    expect(reason.code).toBe('monthly_limit');
    expect(reason.cards_used).toBe(80);
    expect(reason.limit).toBe(100);
    expect(incrementSpy).not.toHaveBeenCalled();
    expect(mockStorageUploadFile).not.toHaveBeenCalled();
  });
});

describe('UploadService.restartClaudeJob — mid-loop credit trip with salvage', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  let db: Knex;
  let workspaceBase: string;

  beforeAll(() => {
    workspaceBase = fs.mkdtempSync(
      path.join(os.tmpdir(), 'restart-salvage-base-')
    );
    process.env.WORKSPACE_BASE = workspaceBase;
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
    fs.rmSync(workspaceBase, { recursive: true, force: true });
  });

  beforeEach(async () => {
    mockGenerateDeckInfo.mockReset();
    mockStorageUploadFile.mockClear();
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('jobs', (t) => {
      t.increments('id');
      t.string('owner').notNullable();
      t.string('object_id').notNullable();
      t.string('title');
      t.string('type');
      t.string('status');
      t.timestamp('created_at').defaultTo(db.fn.now());
      t.timestamp('last_edited_time');
      t.string('job_reason_failure');
      t.integer('card_count');
    });
    const workspaceDir = path.join(workspaceBase, 'job-obj-salvage');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, 'page.html'),
      '<html><body>Q/A</body></html>'
    );
    fs.writeFileSync(path.join(workspaceDir, 'deck.apkg'), Buffer.from('apkg'));
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function waitForUpload(): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if (mockStorageUploadFile.mock.calls.length > 0) {
        return;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  it('ships the cards salvaged before the trip instead of discarding them', async () => {
    await db('jobs').insert({
      owner: '42',
      object_id: 'job-obj-salvage',
      title: 'Deck',
      type: 'claude',
      status: 'done',
      last_edited_time: new Date(),
    });
    mockGenerateDeckInfo.mockRejectedValue(
      new AiCreditsTrippedWithSalvage([
        { name: 'Deck', cards: [{ front: 'q', back: 'a' }] },
      ] as unknown as DeckInfo[])
    );

    const service = new UploadService(
      buildRepository(),
      new JobRepository(db),
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = {
      params: { jobId: 'job-obj-salvage' },
      body: {},
    } as unknown as express.Request;
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;

    await service.restartClaudeJob(req, res);
    await waitForUpload();

    expect(mockStorageUploadFile).toHaveBeenCalledTimes(1);
  });
});

describe('UploadService.handleUpload — signup_origin attribution', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    trackMock.mockClear();
    mockFirstApkg = Buffer.from('fake-apkg');
    mockWorkspaceId = 'test-ws-id';
  });

  function mockSingleDeck(cardCount: number) {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi
          .fn()
          .mockResolvedValue({ packages: [{ name: 'deck', cardCount }] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });
  }

  function firstTouchCookie(landingPath: string) {
    return JSON.stringify({ landingPath });
  }

  it('stamps the resolved signup_origin on upload_started and conversion_succeeded from the first_touch cookie', async () => {
    mockSingleDeck(12);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      cookies: { first_touch: firstTouchCookie('/pricing') },
    } as Partial<express.Request>);
    const { res, capturedStatus } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(trackMock).toHaveBeenCalledWith(
      'upload_started',
      expect.objectContaining({
        props: expect.objectContaining({ signup_origin: '/pricing' }),
      })
    );
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.objectContaining({
        props: expect.objectContaining({ signup_origin: '/pricing' }),
      })
    );
  });

  it('stamps the resolved signup_origin on conversion_failed for an over-limit upload', async () => {
    mockSingleDeck(30);
    const usersRepo = buildUsersRepo({
      getCardUsage: vi
        .fn()
        .mockResolvedValue({ cards_used: 80, month_started_at: new Date() }),
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      cookies: { first_touch: firstTouchCookie('/photo-to-deck') },
    } as Partial<express.Request>);
    const { res } = buildResponse();
    (res.redirect as unknown as Mock).mockReturnValue(res);
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({
          reason: 'monthly_limit',
          signup_origin: '/photo-to-deck',
        }),
      })
    );
  });

  it('stamps signup_origin=null when the request carries no first_touch cookie', async () => {
    mockSingleDeck(12);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(trackMock).toHaveBeenCalledWith(
      'upload_started',
      expect.objectContaining({
        props: expect.objectContaining({ signup_origin: null }),
      })
    );
  });
});

describe('UploadService.handleUpload — in-flight duplicate guard', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    trackMock.mockClear();
    mockWorkspaceId = 'guard-ws-id';
  });

  function buildJobRepo(): JobRepository {
    return {
      create: vi.fn().mockResolvedValue(undefined),
      updateJobStatus: vi.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;
  }

  function buildService() {
    return new UploadService(
      buildRepository(),
      buildJobRepo(),
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
  }

  function buildAiRequest(contents: string, name = 'chapter.pdf') {
    return buildRequest({
      files: [
        {
          originalname: name,
          mimetype: 'application/pdf',
          size: contents.length,
          buffer: Buffer.from(contents),
        },
      ],
      body: { 'claude-ai-flashcards': 'true' },
    } as unknown as Partial<express.Request>);
  }

  function buildPayingResponse() {
    const built = buildResponse();
    (built.res.locals as Record<string, unknown>).owner = 42;
    (built.res.locals as Record<string, unknown>).patreon = true;
    return built;
  }

  it('rejects a second identical upload while the first is still converting', async () => {
    let finishFirst: (() => void) | undefined;
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn(
          () =>
            new Promise((resolve) => {
              finishFirst = () => resolve({ packages: [] });
            })
        ),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = buildService();
    const firstRes = buildPayingResponse();
    await service.handleUpload(buildAiRequest('same bytes'), firstRes.res);
    expect(firstRes.capturedStatus()).toBe(202);

    const secondRes = buildPayingResponse();
    await service.handleUpload(buildAiRequest('same bytes'), secondRes.res);

    expect(secondRes.capturedStatus()).toBe(409);
    expect(secondRes.capturedJson()).toMatchObject({
      code: 'conversion_in_flight',
    });
    expect(MockGeneratePackagesUseCase).toHaveBeenCalledTimes(1);

    finishFirst?.();
  });

  it('allows different content to convert concurrently', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn(() => new Promise(() => {})),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = buildService();
    const firstRes = buildPayingResponse();
    await service.handleUpload(buildAiRequest('doc one'), firstRes.res);
    const secondRes = buildPayingResponse();
    await service.handleUpload(buildAiRequest('doc two'), secondRes.res);

    expect(firstRes.capturedStatus()).toBe(202);
    expect(secondRes.capturedStatus()).toBe(202);
  });

  it('releases the guard when the conversion finishes, allowing a re-upload', async () => {
    let finishFirst: (() => void) | undefined;
    MockGeneratePackagesUseCase.mockImplementationOnce(function () {
      return {
        execute: vi.fn(
          () =>
            new Promise((_, reject) => {
              finishFirst = () => reject(new EmptyDeckError());
            })
        ),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    }).mockImplementation(function () {
      return {
        execute: vi.fn(() => new Promise(() => {})),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = buildService();
    const firstRes = buildPayingResponse();
    await service.handleUpload(buildAiRequest('retry bytes'), firstRes.res);

    finishFirst?.();
    await new Promise((resolve) => setImmediate(resolve));

    const retryRes = buildPayingResponse();
    await service.handleUpload(buildAiRequest('retry bytes'), retryRes.res);
    expect(retryRes.capturedStatus()).toBe(202);
  });

  it('never blocks two different users uploading the same content', async () => {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn(() => new Promise(() => {})),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });

    const service = buildService();
    const firstRes = buildPayingResponse();
    await service.handleUpload(buildAiRequest('shared bytes'), firstRes.res);

    const otherUser = buildPayingResponse();
    (otherUser.res.locals as Record<string, unknown>).owner = 43;
    await service.handleUpload(buildAiRequest('shared bytes'), otherUser.res);

    expect(otherUser.capturedStatus()).toBe(202);
  });
});

describe('UploadService.handleUpload — image uploads route through vision', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  const ONE_BY_ONE_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({ packages: [] }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });
    trackMock.mockClear();
    mockWorkspaceId = 'image-ws-id';
  });

  function buildVisionUseCase(execute: Mock) {
    return { execute } as unknown as PhotoToFlashcardsUseCase;
  }

  function buildServiceWithVision(vision: PhotoToFlashcardsUseCase) {
    return new UploadService(
      buildRepository(),
      {
        create: vi.fn().mockResolvedValue(undefined),
      } as unknown as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ photoToFlashcards: vision })
    );
  }

  function buildImageRequest(overrides: Partial<express.Request> = {}) {
    return buildRequest({
      files: [
        {
          originalname: 'lecture-slide.png',
          mimetype: 'image/png',
          size: 2048,
          buffer: Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'),
        },
      ],
      body: {},
      ...overrides,
    } as unknown as Partial<express.Request>);
  }

  function signedInResponse() {
    const built = buildResponse();
    (built.res.locals as Record<string, unknown>).owner = 42;
    return built;
  }

  it('converts a single-image upload through the vision pipeline and returns the apkg', async () => {
    const apkgPath = path.join(os.tmpdir(), `vision-upload-${Date.now()}.apkg`);
    const apkgBytes = Buffer.from('fake-apkg-bytes');
    fs.writeFileSync(apkgPath, apkgBytes);
    const execute = vi.fn().mockResolvedValue({
      apkgPath,
      cardCount: 7,
      estimatedCostUsd: 0.01,
      tileCount: 1,
      mcqCount: 0,
      mcqSkippedCount: 0,
    });
    const service = buildServiceWithVision(buildVisionUseCase(execute));
    const { res, capturedStatus, capturedSend } = signedInResponse();

    await service.handleUpload(buildImageRequest(), res);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        imageBase64: ONE_BY_ONE_PNG_BASE64,
        mediaType: 'image/png',
        owner: '42',
        imageDimensions: { width: 1, height: 1 },
        usageSurface: 'photo_to_deck_upload',
      })
    );
    expect(capturedStatus()).toBe(200);
    expect(capturedSend()).toEqual(apkgBytes);
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_succeeded',
      expect.objectContaining({ userId: 42 })
    );
  });

  it('names the deck as an attachment, which sets the streamed type, and sets no type of its own', async () => {
    const apkgPath = path.join(os.tmpdir(), `vision-type-${Date.now()}.apkg`);
    fs.writeFileSync(apkgPath, Buffer.from('fake-apkg-bytes'));
    const execute = vi.fn().mockResolvedValue({
      apkgPath,
      cardCount: 7,
      estimatedCostUsd: 0.01,
      tileCount: 1,
      mcqCount: 0,
      mcqSkippedCount: 0,
    });
    const service = buildServiceWithVision(buildVisionUseCase(execute));
    const { res } = signedInResponse();

    await service.handleUpload(buildImageRequest(), res);

    expect(res.attachment).toHaveBeenCalledWith('/lecture-slide');
    expect(res.set).not.toHaveBeenCalledWith('Content-Type', expect.anything());
  });

  it('surfaces the vision quota error with its status instead of a silent failure', async () => {
    const quotaError = Object.assign(
      new Error(
        "Free plan is 5 photos per month. You've used 5. Paid plans include AI credits for more."
      ),
      { status: 429, used: 5, limit: 5 }
    );
    const execute = vi.fn().mockRejectedValue(quotaError);
    const service = buildServiceWithVision(buildVisionUseCase(execute));
    const { res, capturedStatus, capturedJson } = signedInResponse();

    await service.handleUpload(buildImageRequest(), res);

    expect(capturedStatus()).toBe(429);
    const body = capturedJson() as {
      code: string;
      message: string;
      limit?: number;
    };
    expect(body.code).toBe('image_conversion_failed');
    expect(body.limit).toBe(5);
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({ reason: 'image_429' }),
      })
    );
  });

  it('leaves an anonymous image upload on the image_only_no_text floor and never calls vision', async () => {
    const execute = vi.fn();
    const service = buildServiceWithVision(buildVisionUseCase(execute));
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(buildImageRequest(), res);

    expect(execute).not.toHaveBeenCalled();
    expect(capturedStatus()).toBe(400);
    expect((capturedJson() as { code: string }).code).toBe(
      'image_only_no_text'
    );
  });
});

describe('UploadService.handleUpload — stored card options', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    trackMock.mockClear();
    mockFirstApkg = Buffer.from('fake-apkg');
    mockWorkspaceId = 'test-ws-id';
  });

  const guidEntries = [
    { blockId: 'block-a', sourcePageId: 'page-1', guid: 'block-guid-a' },
  ];

  function buildGuidLedger() {
    return {
      getAllForOwner: vi.fn().mockResolvedValue({ 'block-a': 'old-guid' }),
      getUploadIdentityForOwner: vi.fn().mockResolvedValue({}),
      record: vi.fn().mockResolvedValue(undefined),
      reissue: vi.fn().mockResolvedValue(undefined),
    };
  }

  function mockOneDeck() {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [{ name: 'deck', cardCount: 1, guidEntries }],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });
  }

  it('re-keys through a stored block-id-identity the body never sent', async () => {
    mockOneDeck();
    const guidLedger = buildGuidLedger();
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo({
        getCardOptions: vi
          .fn()
          .mockResolvedValue({ 'block-id-identity': 'true' }),
      } as unknown as Partial<UsersRepository>),
      ...fakeUploadServiceDeps({ guidLedger })
    );
    const req = buildRequest();
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(guidLedger.reissue).toHaveBeenCalledWith(42, guidEntries);
  });

  it('lets a stored block-id-identity beat a stale false from the browser', async () => {
    mockOneDeck();
    const guidLedger = buildGuidLedger();
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo({
        getCardOptions: vi
          .fn()
          .mockResolvedValue({ 'block-id-identity': 'true' }),
      } as unknown as Partial<UsersRepository>),
      ...fakeUploadServiceDeps({ guidLedger })
    );
    const req = buildRequest({
      body: { 'block-id-identity': 'false' },
    } as Partial<express.Request>);
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(guidLedger.reissue).toHaveBeenCalledWith(42, guidEntries);
    expect(guidLedger.record).not.toHaveBeenCalled();
  });

  it('fills an ordinary option the body omits from the stored options', async () => {
    mockOneDeck();
    const attachCustomTemplates = vi.fn().mockResolvedValue(undefined);
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo({
        getCardOptions: vi.fn().mockResolvedValue({ template: 'custom' }),
      } as unknown as Partial<UsersRepository>),
      ...fakeUploadServiceDeps({
        settings: { attachCustomTemplates } as unknown as ISettingsRepository,
      })
    );
    const req = buildRequest();
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(attachCustomTemplates).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ template: 'custom' })
    );
  });

  it('lets the browser win for an ordinary option it did send', async () => {
    mockOneDeck();
    const attachCustomTemplates = vi.fn().mockResolvedValue(undefined);
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo({
        getCardOptions: vi.fn().mockResolvedValue({ template: 'stored' }),
      } as unknown as Partial<UsersRepository>),
      ...fakeUploadServiceDeps({
        settings: { attachCustomTemplates } as unknown as ISettingsRepository,
      })
    );
    const req = buildRequest({
      body: { template: 'custom' },
    } as Partial<express.Request>);
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.handleUpload(req, res);

    expect(attachCustomTemplates).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ template: 'custom' })
    );
  });

  it('never reads stored options for an anonymous upload', async () => {
    mockOneDeck();
    const getCardOptions = vi
      .fn()
      .mockResolvedValue({ 'block-id-identity': 'true' });
    const guidLedger = buildGuidLedger();
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo({ getCardOptions } as unknown as Partial<UsersRepository>),
      ...fakeUploadServiceDeps({ guidLedger })
    );
    const req = buildRequest();
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(getCardOptions).not.toHaveBeenCalled();
    expect(guidLedger.reissue).not.toHaveBeenCalled();
  });
});

describe('UploadService.handleSyncUpload — persisted copy for a signed-in owner', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    mockStorageUploadFile.mockClear();
    trackMock.mockClear();
    mockFirstApkg = Buffer.from('fake-apkg');
    mockWorkspaceId = 'test-ws-id';
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [{ name: 'deck', cardCount: 12 }],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });
  });

  function exposedHeaders(res: express.Response): string {
    const call = (res.set as Mock).mock.calls.find(
      ([name]) => name === 'Access-Control-Expose-Headers'
    );
    return call?.[1] ?? '';
  }

  it('persists the built deck, records an uploads row, and advertises the key', async () => {
    const update = vi.fn().mockResolvedValue([]);
    const usersRepo = buildUsersRepo();
    const service = new UploadService(
      { ...buildRepository(), update },
      {} as JobRepository,
      usersRepo,
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedSend } = buildResponse();
    res.locals.owner = 42;
    res.locals.requestId = 'req-4271';

    await service.handleUpload(req, res);

    expect(mockStorageUploadFile).toHaveBeenCalledTimes(1);
    const [key, body] = mockStorageUploadFile.mock.calls[0] as [string, Buffer];
    expect(key).toMatch(/\.apkg$/);
    expect(body).toEqual(Buffer.from('fake-apkg'));
    expect(update).toHaveBeenCalledWith(
      42,
      'deck',
      key,
      expect.any(Number),
      null,
      { droppedImageCount: 0, imageDropReason: null }
    );
    expect(res.set).toHaveBeenCalledWith('X-Download-Key', key);
    expect(exposedHeaders(res)).toContain('X-Download-Key');
    expect(capturedSend()).toEqual(Buffer.from('fake-apkg'));
    expect(usersRepo.incrementCardUsage).toHaveBeenCalledTimes(1);
  });

  it('keeps streaming for an anonymous upload without persisting or advertising a key', async () => {
    const update = vi.fn().mockResolvedValue([]);
    const service = new UploadService(
      { ...buildRepository(), update },
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedSend } = buildResponse();

    await service.handleUpload(req, res);

    expect(mockStorageUploadFile).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(res.set).not.toHaveBeenCalledWith(
      'X-Download-Key',
      expect.anything()
    );
    expect(exposedHeaders(res)).not.toContain('X-Download-Key');
    expect(capturedSend()).toEqual(Buffer.from('fake-apkg'));
  });

  it('still sends the deck when the copy cannot be persisted', async () => {
    mockStorageUploadFile.mockRejectedValueOnce(new Error('storage down'));
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest();
    const { res, capturedStatus, capturedSend } = buildResponse();
    res.locals.owner = 42;

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(capturedSend()).toEqual(Buffer.from('fake-apkg'));
    expect(res.set).not.toHaveBeenCalledWith(
      'X-Download-Key',
      expect.anything()
    );
  });
});

describe('UploadService.handleSyncUpload — anonymous recovery copy (#4651)', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;
  const token = '3f2b8c1e-9a4d-4e7f-8b21-5c6d7e8f9a0b';

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    mockStorageUploadFile.mockClear();
    mockFirstApkg = Buffer.from('fake-apkg');
    mockWorkspaceId = 'test-ws-id';
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockResolvedValue({
          packages: [{ name: 'deck', cardCount: 12 }],
          warnings: [],
        }),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });
  });

  function buildService() {
    return new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
  }

  it('stores the finished deck under the key the visitor can rebuild', async () => {
    const req = buildRequest({
      cookies: { anon_id: 'anon-recover' },
      headers: { 'x-recovery-token': token },
    });
    const { res, capturedSend } = buildResponse();

    await buildService().handleUpload(req, res);

    expect(mockStorageUploadFile).toHaveBeenCalledWith(
      anonRecoveryKey('anon-recover', token),
      Buffer.from('fake-apkg')
    );
    expect(capturedSend()).toEqual(Buffer.from('fake-apkg'));
  });

  it.each([
    ['no token header', { cookies: { anon_id: 'anon-recover' }, headers: {} }],
    [
      'a malformed token',
      {
        cookies: { anon_id: 'anon-recover' },
        headers: { 'x-recovery-token': '../held/x' },
      },
    ],
    ['no anon_id cookie', { headers: { 'x-recovery-token': token } }],
  ])('stores nothing with %s', async (_label, overrides) => {
    const req = buildRequest(overrides as Partial<express.Request>);
    const { res, capturedSend } = buildResponse();

    await buildService().handleUpload(req, res);

    expect(mockStorageUploadFile).not.toHaveBeenCalled();
    expect(capturedSend()).toEqual(Buffer.from('fake-apkg'));
  });

  it('stores no recovery copy for a signed-in owner', async () => {
    const req = buildRequest({
      cookies: { anon_id: 'anon-recover' },
      headers: { 'x-recovery-token': token },
    });
    const { res } = buildResponse();
    res.locals.owner = 42;

    await buildService().handleUpload(req, res);

    const keys = mockStorageUploadFile.mock.calls.map(([key]) => key);
    expect(keys).not.toContain(anonRecoveryKey('anon-recover', token));
  });

  it('still sends the deck when the recovery copy cannot be stored', async () => {
    mockStorageUploadFile.mockRejectedValueOnce(new Error('storage down'));
    const req = buildRequest({
      cookies: { anon_id: 'anon-recover' },
      headers: { 'x-recovery-token': token },
    });
    const { res, capturedStatus, capturedSend } = buildResponse();

    await buildService().handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(capturedSend()).toEqual(Buffer.from('fake-apkg'));
  });
});

describe('UploadService.handleUpload — image drops without a vision path (#4400)', () => {
  const imageFile = (name: string) =>
    ({
      originalname: name,
      mimetype: 'image/png',
      size: 2048,
      path: `/tmp/${name}`,
    }) as unknown as Express.Multer.File;

  it('answers an anonymous photo drop with the Photo to Deck pointer before any parse', async () => {
    const execute = vi.fn().mockResolvedValue({ packages: [] });
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return { execute } as unknown as InstanceType<
        typeof GeneratePackagesUseCase
      >;
    });
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [imageFile('lecture-page.png')],
      cookies: { anon_id: 'anon-photo' },
    } as Partial<express.Request>);
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect((capturedJson() as { code: string }).code).toBe(
      'image_only_no_text'
    );
    expect(execute).not.toHaveBeenCalled();
    expect(trackMock).not.toHaveBeenCalledWith(
      'conversion_failed',
      expect.anything()
    );
    expect(trackMock).toHaveBeenCalledWith(
      'image_only_no_text_shown',
      expect.objectContaining({ anonymousId: 'anon-photo' })
    );
  });

  it('answers a signed-in multi-photo drop the same way instead of parsing', async () => {
    const execute = vi.fn().mockResolvedValue({ packages: [] });
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return { execute } as unknown as InstanceType<
        typeof GeneratePackagesUseCase
      >;
    });
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const req = buildRequest({
      files: [imageFile('one.png'), imageFile('two.png')],
    } as Partial<express.Request>);
    const { res, capturedStatus, capturedJson } = buildResponse();
    res.locals.owner = 42;

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(400);
    expect((capturedJson() as { code: string }).code).toBe(
      'image_only_no_text'
    );
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('resolveUploadWarning — stray cloze markup', () => {
  it('turns the coded count into user copy, summing across decks', () => {
    expect(resolveUploadWarning(['stray-cloze:2', 'stray-cloze:1'], null)).toBe(
      '3 cards contain cloze syntax like {{c1::text}} but cloze mode is off, so the braces show on the card. Turn on cloze mode and convert again.'
    );
  });

  it('uses the singular for one card', () => {
    expect(resolveUploadWarning(['stray-cloze:1'], null)).toMatch(
      /^1 card contains cloze syntax/
    );
  });

  it('keeps the markdown heuristic warning ahead of stray cloze', () => {
    expect(
      resolveUploadWarning(['stray-cloze:1', 'markdown-heuristic'], null)
    ).toMatch(/heuristic detection/);
  });
});

describe('resolveUploadWarning — package over the AnkiWeb sync limit', () => {
  it('turns the coded size into the sync warning and ranks it first', () => {
    expect(
      resolveUploadWarning(
        ['markdown-heuristic', 'apkg-over-100mb:210.4'],
        null
      )
    ).toBe(
      "This deck is 210.4 MB. AnkiWeb won't sync packages over 100 MB, so split it into smaller decks before syncing."
    );
  });
});

describe('resolveUploadWarning — notes sharing a guid', () => {
  it('turns the coded count into user copy, summing across packages', () => {
    expect(
      resolveUploadWarning(['duplicate-guid:2', 'duplicate-guid:1'], null)
    ).toMatch(/^3 cards are exact duplicates/);
  });

  it('ranks below the sync-size warning and above the markdown heuristic', () => {
    expect(
      resolveUploadWarning(['duplicate-guid:1', 'apkg-over-100mb:210.4'], null)
    ).toMatch(/^This deck is 210.4 MB/);
    expect(
      resolveUploadWarning(
        ['markdown-heuristic', 'stray-cloze:2', 'duplicate-guid:1'],
        null
      )
    ).toMatch(/^1 card is an exact duplicate/);
  });
});

describe('resolveUploadWarning — AI credits exhausted', () => {
  it('falls back to the no-reset line when the balance read fails (null)', () => {
    const text = resolveUploadWarning(
      ['markdown-heuristic', 'ai-credits-exhausted'],
      null
    );
    expect(text).toMatch(/built without AI/);
    expect(text).not.toMatch(/free/);
    expect(text).not.toMatch(/reset/);
    expect(text).not.toMatch(/90 days/);
  });

  it('points a subscription plan at its own reset, never a free one', () => {
    const text = resolveUploadWarning(
      ['markdown-heuristic', 'ai-credits-exhausted'],
      'period'
    );
    expect(text).toMatch(/built without AI/);
    expect(text).not.toMatch(/free/);
    expect(text).toMatch(/Or wait for your plan's credits to reset\./);
  });

  it('promises a pass holder no reset, since a pass does not reset', () => {
    const text = resolveUploadWarning(
      ['markdown-heuristic', 'ai-credits-exhausted'],
      'pass'
    );
    expect(text).toMatch(/built without AI/);
    expect(text).not.toMatch(/free/);
    expect(text).not.toMatch(/reset/);
    expect(text).not.toMatch(/90 days/);
  });

  it('keeps the oversize warning ahead of the credits notice', () => {
    expect(
      resolveUploadWarning(
        ['ai-credits-exhausted', 'apkg-over-100mb:210.4'],
        null
      )
    ).toMatch(/AnkiWeb won't sync/);
  });

  it('keeps the locked-PDF notice ahead of the credits notice', () => {
    expect(
      resolveUploadWarning(
        ['ai-credits-exhausted', 'This PDF is password-protected.'],
        null
      )
    ).toMatch(/password-protected/);
  });
});

describe('UploadService.handleUpload — failure events for the success-rate tile', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    trackMock.mockClear();
  });

  function failWith(error: Error) {
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return {
        execute: vi.fn().mockRejectedValue(error),
      } as unknown as InstanceType<typeof GeneratePackagesUseCase>;
    });
  }

  function buildService(jobRepository: JobRepository = {} as JobRepository) {
    return new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
  }

  const conversionFailedReasons = () =>
    trackMock.mock.calls
      .filter(([name]) => name === 'conversion_failed')
      .map(([, payload]) => payload.props.reason);

  it.each([
    [
      'a parser crash',
      Object.assign(new Error('parser crashed'), { code: 'PARSER_CRASH' }),
      'parser_crash',
    ],
    [
      'a worker timeout',
      Object.assign(new Error('worker timed out'), { code: 'WORKER_TIMEOUT' }),
      'worker_timeout',
    ],
    ['an unclassified error', new Error('something broke'), 'unknown'],
  ])(
    'records %s from a synchronous upload as conversion_failed',
    async (_label, error, reason) => {
      failWith(error);
      const req = buildRequest({
        cookies: { anon_id: 'anon-failed' },
      } as Partial<express.Request>);
      const { res } = buildResponse();

      await buildService().handleUpload(req, res);

      expect(trackMock).toHaveBeenCalledWith(
        'conversion_failed',
        expect.objectContaining({
          anonymousId: 'anon-failed',
          userId: null,
          props: expect.objectContaining({ reason, source: 'upload' }),
        })
      );
    }
  );

  it('records a missing pdfinfo binary as pdf_unreadable, because that is our tooling failing', async () => {
    failWith(new Error('pdfinfo_spawn_failed: ENOENT'));
    const { res } = buildResponse();

    await buildService().handleUpload(buildRequest(), res);

    expect(conversionFailedReasons()).toEqual(['pdf_unreadable']);
  });

  it.each([
    ['a corrupt PDF', 'pdfinfo_failed code=1'],
    ['an unreadable docx', 'docx_parse_failed: not a zip'],
    [
      'an Anki package uploaded as a source file',
      '"x.apkg" is already an Anki deck.',
    ],
  ])(
    'does not count %s, which is a problem with the user file',
    async (_label, message) => {
      failWith(new Error(message));
      const { res } = buildResponse();

      await buildService().handleUpload(buildRequest(), res);

      expect(conversionFailedReasons()).toEqual([]);
    }
  );

  it.each([
    'ImageOnlyContentError',
    'DeckTooLargeError',
    'ClaudeParseError',
    'ClaudeLargeSectionError',
    'PythonZeroCardsError',
  ])(
    'does not count %s once the worker has rebuilt it as a plain error',
    async (name) => {
      failWith(Object.assign(new Error('rebuilt by the worker'), { name }));
      const { res } = buildResponse();

      await buildService().handleUpload(buildRequest(), res);

      expect(conversionFailedReasons()).toEqual([]);
    }
  );

  it.each([
    [
      'a client that hung up mid upload',
      Object.assign(new Error('request aborted'), {
        type: 'entity.parse.failed',
      }),
    ],
    [
      'a file with no content',
      Object.assign(new Error('nothing to convert'), {
        name: 'EmptyContentError',
      }),
    ],
  ])('does not count %s as a technical failure', async (_label, error) => {
    failWith(error);
    const { res } = buildResponse();

    await buildService().handleUpload(buildRequest(), res);

    expect(conversionFailedReasons()).toEqual([]);
  });

  describe('asynchronous AI uploads', () => {
    function buildJobRepo(): JobRepository {
      return {
        create: vi.fn().mockResolvedValue(undefined),
        updateJobStatus: vi.fn().mockResolvedValue(undefined),
      } as unknown as JobRepository;
    }

    function buildAiRequest() {
      return buildRequest({
        files: [
          {
            originalname: 'chapter.pdf',
            mimetype: 'application/pdf',
            size: 10,
            buffer: Buffer.from('bytes'),
          },
        ],
        body: { 'claude-ai-flashcards': 'true' },
      } as unknown as Partial<express.Request>);
    }

    function buildPayingResponse() {
      const built = buildResponse();
      (built.res.locals as Record<string, unknown>).owner = 42;
      (built.res.locals as Record<string, unknown>).patreon = true;
      return built;
    }

    const settle = () => new Promise((resolve) => setImmediate(resolve));

    it('records an unexpected background failure for the signed-in owner', async () => {
      failWith(
        Object.assign(new Error('parser crashed'), { code: 'PARSER_CRASH' })
      );
      const { res } = buildPayingResponse();

      await buildService(buildJobRepo()).handleUpload(buildAiRequest(), res);
      await settle();

      expect(trackMock).toHaveBeenCalledWith(
        'conversion_failed',
        expect.objectContaining({
          userId: 42,
          props: expect.objectContaining({ reason: 'parser_crash' }),
        })
      );
    });

    it('does not count an empty deck as a technical failure', async () => {
      failWith(new EmptyDeckError());
      const { res } = buildPayingResponse();

      await buildService(buildJobRepo()).handleUpload(buildAiRequest(), res);
      await settle();

      expect(conversionFailedReasons()).toEqual([]);
    });

    it.each([
      'ImageOnlyContentError',
      'ClaudeParseError',
      'ClaudeLargeSectionError',
    ])(
      'does not count %s once the worker has rebuilt it as a plain error',
      async (name) => {
        failWith(Object.assign(new Error('rebuilt by the worker'), { name }));
        const { res } = buildPayingResponse();

        await buildService(buildJobRepo()).handleUpload(buildAiRequest(), res);
        await settle();

        expect(conversionFailedReasons()).toEqual([]);
      }
    );

    it('records a credits error that lost its class across the worker boundary as ai_credits_exhausted', async () => {
      failWith(
        Object.assign(new Error("You're out of AI credits."), {
          name: 'AiCreditsExhaustedError',
        })
      );
      const { res } = buildPayingResponse();

      await buildService(buildJobRepo()).handleUpload(buildAiRequest(), res);
      await settle();

      expect(conversionFailedReasons()).toEqual(['ai_credits_exhausted']);
    });
  });

  it('adds no second event for a credits error the synchronous path already tracked', async () => {
    failWith(new AiCreditsExhaustedError());
    const { res } = buildResponse();

    await buildService().handleUpload(buildRequest(), res);

    expect(conversionFailedReasons()).toEqual([]);
  });
});

describe('UploadService.handleSyncUpload — anonymous partial delivery', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;

  const TREATMENT_ID = 'anon-held';

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    trackMock.mockClear();
    mockStorageUploadFile.mockClear();
    mockFirstApkg = Buffer.from('fake-apkg');
    mockWorkspaceId = 'test-ws-id';
  });

  function buildEligibleRequest(anonId?: string): express.Request {
    return buildRequest({
      files: [
        {
          originalname: 'study-notes.html',
          mimetype: 'text/html',
          size: 1024,
          path: '/tmp/study-notes.html',
          buffer: Buffer.from('<html>study notes</html>'),
        },
      ],
      ...(anonId ? { cookies: { anon_id: anonId } } : {}),
    } as Partial<express.Request>);
  }

  function mockPartial(
    packages: Array<{ name: string; cardCount: number }>,
    cardsHeldBack?: number
  ) {
    const execute = vi
      .fn()
      .mockResolvedValue({ packages, warnings: [], cardsHeldBack });
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return { execute } as unknown as InstanceType<
        typeof GeneratePackagesUseCase
      >;
    });
    return execute;
  }

  function responseWithRedirect() {
    const built = buildResponse();
    let redirectedTo: string | null = null;
    (built.res.redirect as unknown as Mock).mockImplementation(
      (url: string) => {
        redirectedTo = url;
        return built.res;
      }
    );
    return { ...built, redirectedTo: () => redirectedTo };
  }

  function headerValue(
    res: express.Response,
    name: string
  ): string | undefined {
    const call = (res.set as Mock).mock.calls.find(
      ([headerName]) => headerName === name
    );
    return call?.[1] as string | undefined;
  }

  function exposedHeaders(res: express.Response): string {
    return headerValue(res, 'Access-Control-Expose-Headers') ?? '';
  }

  function conversionSucceededProps(): Record<string, unknown> {
    const call = trackMock.mock.calls.find(
      ([name]) => name === 'conversion_succeeded'
    );
    return (call?.[1] as { props: Record<string, unknown> }).props;
  }

  function conversionFailedProps(): Record<string, unknown> {
    const call = trackMock.mock.calls.find(
      ([name]) => name === 'conversion_failed'
    );
    return (call?.[1] as { props: Record<string, unknown> }).props;
  }

  function serviceUnderTest(heldDeck?: InMemoryHeldDeckRepository) {
    return new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps(heldDeck ? { heldDeck } : {})
    );
  }

  it('refuses an over-cap anonymous upload and tags no arm when the flag is off', async () => {
    mockGetFeatureFlag.mockResolvedValue(false);
    const execute = mockPartial([{ name: 'deck', cardCount: 30 }]);
    const req = buildEligibleRequest(TREATMENT_ID);
    const { res, capturedSend, redirectedTo } = responseWithRedirect();

    await serviceUnderTest().handleUpload(req, res);

    expect(redirectedTo()).toBe('/limit?kind=anonymous');
    expect(capturedSend()).toBeNull();
    expect(execute.mock.calls[0][6]).not.toHaveProperty('cardLimit');
    const props = conversionFailedProps();
    expect(props.reason).toBe('anonymous_cap');
    expect(props).not.toHaveProperty('arm');
    expect(props).not.toHaveProperty('card_count_bucket');
  });

  it('holds the deck behind an account step for the treatment arm', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const execute = mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    const req = buildEligibleRequest(TREATMENT_ID);
    const { res, capturedStatus, capturedJson, capturedSend } = buildResponse();

    await serviceUnderTest(heldDeck).handleUpload(req, res);

    expect(execute.mock.calls[0][6]).toMatchObject({
      cardLimit: ANONYMOUS_CARD_CAP,
    });
    expect(capturedStatus()).toBe(200);
    expect(capturedJson()).toEqual({
      kind: 'held',
      cardCount: 21,
      cardsHeldBack: 13,
      totalCards: 34,
    });
    expect(capturedSend()).toBeNull();
    expect(mockStorageUploadFile).toHaveBeenCalledTimes(1);
    const [storageKey, bytes] = mockStorageUploadFile.mock.calls[0];
    expect(storageKey).toMatch(/^held\//);
    expect(bytes).toEqual(Buffer.from('<html>study notes</html>'));
    expect(heldDeck.rows).toHaveLength(1);
    expect(heldDeck.rows[0]).toMatchObject({
      anon_id: TREATMENT_ID,
      card_count: 21,
      cards_held_back: 13,
      claimed_at: null,
    });
    expect(heldDeck.rows[0].storage_key).toMatch(/^held\//);
    const props = conversionSucceededProps();
    expect(props).toMatchObject({
      card_limit_partial: true,
      cards_held_back: 13,
      arm: 'treatment',
      held: true,
    });
    expect(props.card_count_bucket).toBeDefined();
    expect(trackMock).not.toHaveBeenCalledWith(
      'conversion_failed',
      expect.anything()
    );
    expect(trackMock).not.toHaveBeenCalledWith(
      'paywall_shown',
      expect.anything()
    );
  });

  it('marks an over-a-month held deck for the Day Pass card when the flag is on', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockPartial([{ name: 'deck', cardCount: 21 }], 120);
    const heldDeck = new InMemoryHeldDeckRepository();
    const req = buildEligibleRequest(TREATMENT_ID);
    const { res, capturedStatus, capturedJson } = buildResponse();

    await serviceUnderTest(heldDeck).handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(capturedJson()).toEqual({
      kind: 'held',
      cardCount: 21,
      cardsHeldBack: 120,
      totalCards: 141,
      dayPassCard: true,
    });
  });

  it('leaves an over-a-month held deck unmarked when only partial delivery is on', async () => {
    mockGetFeatureFlag.mockImplementation((key: unknown) =>
      Promise.resolve(key === 'anonymous_partial_delivery')
    );
    mockPartial([{ name: 'deck', cardCount: 21 }], 120);
    const heldDeck = new InMemoryHeldDeckRepository();
    const req = buildEligibleRequest(TREATMENT_ID);
    const { res, capturedStatus, capturedJson } = buildResponse();

    await serviceUnderTest(heldDeck).handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(capturedJson()).toEqual({
      kind: 'held',
      cardCount: 21,
      cardsHeldBack: 120,
      totalCards: 141,
    });
    expect(mockGetFeatureFlag).toHaveBeenCalledWith(
      'anonymous_day_pass_card',
      false
    );
  });

  it('does not append the card count to the wall when only partial delivery is on', async () => {
    mockGetFeatureFlag.mockImplementation((key: unknown) =>
      Promise.resolve(key === 'anonymous_partial_delivery')
    );
    mockPartial([{ name: 'deck', cardCount: 130 }]);
    const req = buildEligibleRequest();
    const { res, redirectedTo } = responseWithRedirect();

    await serviceUnderTest().handleUpload(req, res);

    expect(redirectedTo()).toBe('/limit?kind=anonymous');
    expect(mockGetFeatureFlag).toHaveBeenCalledWith(
      'anonymous_day_pass_card',
      false
    );
  });

  it('still redirects to the wall when the card-count flag reads fail', async () => {
    mockGetFeatureFlag.mockImplementation((key: unknown) =>
      key === 'limit_wall_pass_first' || key === 'anonymous_day_pass_card'
        ? Promise.reject(new Error('db down'))
        : Promise.resolve(false)
    );
    mockPartial([{ name: 'deck', cardCount: 130 }]);
    const req = buildEligibleRequest();
    const { res, redirectedTo } = responseWithRedirect();

    await serviceUnderTest().handleUpload(req, res);

    expect(redirectedTo()).toBe('/limit?kind=anonymous');
  });

  it('appends the card count to the wall when the pass-first flag is on', async () => {
    mockGetFeatureFlag.mockImplementation((key: unknown) =>
      Promise.resolve(key === 'limit_wall_pass_first')
    );
    mockPartial([{ name: 'deck', cardCount: 130 }]);
    const req = buildEligibleRequest();
    const { res, redirectedTo } = responseWithRedirect();

    await serviceUnderTest().handleUpload(req, res);

    expect(redirectedTo()).toBe('/limit?kind=anonymous&cards=130');
  });

  it('holds a single zip upload for the treatment arm', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const execute = mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    const req = buildRequest({
      files: [
        {
          originalname: 'study-notes.zip',
          mimetype: 'application/zip',
          size: 2048,
          path: '/tmp/study-notes.zip',
          buffer: Buffer.from('PK\x03\x04 zip bytes'),
        },
      ],
      cookies: { anon_id: TREATMENT_ID },
    } as unknown as Partial<express.Request>);
    const { res, capturedStatus, capturedJson } = buildResponse();

    await serviceUnderTest(heldDeck).handleUpload(req, res);

    expect(execute.mock.calls[0][6]).toMatchObject({
      cardLimit: ANONYMOUS_CARD_CAP,
    });
    expect(capturedStatus()).toBe(200);
    expect(capturedJson()).toEqual({
      kind: 'held',
      cardCount: 21,
      cardsHeldBack: 13,
      totalCards: 34,
    });
    expect(mockStorageUploadFile).toHaveBeenCalledTimes(1);
    const [, bytes] = mockStorageUploadFile.mock.calls[0];
    expect(bytes).toEqual(Buffer.from('PK\x03\x04 zip bytes'));
    expect(heldDeck.rows).toHaveLength(1);
    expect(heldDeck.rows[0]).toMatchObject({
      anon_id: TREATMENT_ID,
      filename: 'study-notes.zip',
      card_count: 21,
      cards_held_back: 13,
      claimed_at: null,
    });
  });

  it('does not expose the storage key to the client', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    const req = buildEligibleRequest(TREATMENT_ID);
    const { res, capturedJson } = buildResponse();

    await serviceUnderTest(heldDeck).handleUpload(req, res);

    expect(JSON.stringify(capturedJson())).not.toContain('held/');
    expect(JSON.stringify(capturedJson())).not.toContain(
      heldDeck.rows[0].storage_key
    );
  });

  it('keeps only the newest unclaimed hold per anon and deletes the superseded object', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockStorageDelete.mockClear();
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    const service = serviceUnderTest(heldDeck);

    await service.handleUpload(
      buildEligibleRequest(TREATMENT_ID),
      buildResponse().res
    );
    expect(heldDeck.rows).toHaveLength(1);
    const firstKey = heldDeck.rows[0].storage_key;

    await service.handleUpload(
      buildEligibleRequest(TREATMENT_ID),
      buildResponse().res
    );

    const unclaimed = heldDeck.rows.filter((row) => row.claimed_at == null);
    expect(unclaimed).toHaveLength(1);
    expect(unclaimed[0].storage_key).not.toBe(firstKey);
    expect(mockStorageDelete).toHaveBeenCalledWith(firstKey);
  });

  it('does not delete a claimed hold when a new one is written for the anon', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockStorageDelete.mockClear();
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    const service = serviceUnderTest(heldDeck);

    await service.handleUpload(
      buildEligibleRequest(TREATMENT_ID),
      buildResponse().res
    );
    const claimedKey = heldDeck.rows[0].storage_key;
    await heldDeck.markClaimed(heldDeck.rows[0].id as number, 7, new Date());

    await service.handleUpload(
      buildEligibleRequest(TREATMENT_ID),
      buildResponse().res
    );

    expect(heldDeck.rows).toHaveLength(2);
    expect(mockStorageDelete).not.toHaveBeenCalledWith(claimedKey);
  });

  it('walls a new hold once the per-IP daily cap is reached', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    const limiter = new InMemoryRateLimiter({
      windowMs: 60_000,
      perKeyMax: 1,
      globalMax: 100,
    });
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ heldDeck }),
      limiter
    );

    const first = buildResponse();
    await service.handleUpload(buildEligibleRequest(TREATMENT_ID), first.res);
    expect(first.capturedStatus()).toBe(200);
    expect(heldDeck.rows).toHaveLength(1);

    const second = responseWithRedirect();
    await service.handleUpload(buildEligibleRequest(TREATMENT_ID), second.res);
    expect(second.redirectedTo()).toBe('/limit?kind=anonymous&cards=34');
    expect(heldDeck.rows).toHaveLength(1);
    expect(conversionFailedProps()).toMatchObject({
      reason: 'anonymous_cap',
      arm: 'treatment',
    });
  });

  function requestFromIp(forwardedFor: string): express.Request {
    const req = buildEligibleRequest(TREATMENT_ID);
    (req as unknown as { headers: Record<string, string> }).headers = {
      'x-forwarded-for': forwardedFor,
    };
    return req;
  }

  it('shares one per-IP bucket across addresses in the same IPv6 /64', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    const limiter = new InMemoryRateLimiter({
      windowMs: 60_000,
      perKeyMax: 1,
      globalMax: 100,
    });
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ heldDeck }),
      limiter
    );

    const first = buildResponse();
    await service.handleUpload(requestFromIp('2001:db8:1:2::1'), first.res);
    expect(first.capturedStatus()).toBe(200);

    const second = responseWithRedirect();
    await service.handleUpload(
      requestFromIp('2001:db8:1:2:aaaa::9'),
      second.res
    );
    expect(second.redirectedTo()).toBe('/limit?kind=anonymous&cards=34');
    expect(heldDeck.rows).toHaveLength(1);
  });

  it('logs the global-budget wall separately from the per-IP cap', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    const limiter = new InMemoryRateLimiter({
      windowMs: 60_000,
      perKeyMax: 10,
      globalMax: 1,
    });
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ heldDeck }),
      limiter
    );
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      await service.handleUpload(
        requestFromIp('198.51.100.1'),
        buildResponse().res
      );
      const second = responseWithRedirect();
      await service.handleUpload(requestFromIp('198.51.100.2'), second.res);

      expect(second.redirectedTo()).toBe('/limit?kind=anonymous&cards=34');
      const messages = infoSpy.mock.calls.map(([message]) => message);
      expect(messages).toContain(
        '[UploadService] held deck throttled by global daily budget'
      );
      expect(messages).not.toContain(
        '[UploadService] held deck throttled by per-IP daily cap'
      );
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('keeps a claimed hold and its file when a claim lands mid-prune', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockStorageDelete.mockClear();
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    const service = serviceUnderTest(heldDeck);

    await service.handleUpload(
      buildEligibleRequest(TREATMENT_ID),
      buildResponse().res
    );
    const first = heldDeck.rows[0];
    await heldDeck.markClaimed(first.id as number, 7, new Date());

    vi.spyOn(heldDeck, 'findUnclaimedByAnonId').mockResolvedValueOnce([
      { id: first.id as number, storageKey: first.storage_key },
    ]);

    await service.handleUpload(
      buildEligibleRequest(TREATMENT_ID),
      buildResponse().res
    );

    expect(heldDeck.rows.some((row) => row.id === first.id)).toBe(true);
    expect(mockStorageDelete).not.toHaveBeenCalledWith(first.storage_key);
  });

  it('walls instead of 500ing when the unclaimed lookup fails', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    vi.spyOn(heldDeck, 'findUnclaimedByAnonId').mockRejectedValueOnce(
      new Error('db down')
    );
    const service = serviceUnderTest(heldDeck);
    const { res, redirectedTo } = responseWithRedirect();

    await service.handleUpload(buildEligibleRequest(TREATMENT_ID), res);

    expect(redirectedTo()).toBe('/limit?kind=anonymous&cards=34');
    expect(heldDeck.rows).toHaveLength(0);
  });

  it('still returns the held deck when the best-effort prune fails', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockStorageDelete.mockClear();
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    const service = serviceUnderTest(heldDeck);

    await service.handleUpload(
      buildEligibleRequest(TREATMENT_ID),
      buildResponse().res
    );
    vi.spyOn(heldDeck, 'deleteUnclaimedByIds').mockRejectedValueOnce(
      new Error('db down')
    );
    const { res, capturedStatus, capturedJson } = buildResponse();

    await service.handleUpload(buildEligibleRequest(TREATMENT_ID), res);

    expect(capturedStatus()).toBe(200);
    expect(capturedJson()).toMatchObject({ kind: 'held' });
    const newest = heldDeck.rows[heldDeck.rows.length - 1];
    expect(newest.claimed_at).toBeNull();
    expect(mockStorageDelete).not.toHaveBeenCalledWith(newest.storage_key);
  });

  it('logs an orphan count when a superseded object fails to delete', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockStorageDelete.mockClear();
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    const service = serviceUnderTest(heldDeck);

    await service.handleUpload(
      buildEligibleRequest(TREATMENT_ID),
      buildResponse().res
    );
    const firstKey = heldDeck.rows[0].storage_key;
    mockStorageDelete.mockResolvedValueOnce(false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { res, capturedStatus } = buildResponse();
      await service.handleUpload(buildEligibleRequest(TREATMENT_ID), res);

      expect(capturedStatus()).toBe(200);
      expect(mockStorageDelete).toHaveBeenCalledWith(firstKey);
      expect(warnSpy).toHaveBeenCalledWith(
        '[UploadService] superseded held objects left in storage',
        expect.objectContaining({ count: 1 })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('never writes a signup hold under an anon_id forged as a plan key', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    // 'plan:42' hashes into the treatment arm, so only the key guard stops it.
    const req = buildEligibleRequest('plan:42');
    const { res, capturedSend, redirectedTo } = responseWithRedirect();

    await serviceUnderTest(heldDeck).handleUpload(req, res);

    expect(redirectedTo()).toBe('/limit?kind=anonymous&cards=34');
    expect(capturedSend()).toBeNull();
    expect(heldDeck.rows).toHaveLength(0);
  });

  it('never writes a signup hold under an anon_id forged as a preview key', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    const heldDeck = new InMemoryHeldDeckRepository();
    const req = buildEligibleRequest('preview:victim');
    const { res, capturedSend, redirectedTo } = responseWithRedirect();

    await serviceUnderTest(heldDeck).handleUpload(req, res);

    expect(redirectedTo()).toBe('/limit?kind=anonymous&cards=34');
    expect(capturedSend()).toBeNull();
    expect(heldDeck.rows).toHaveLength(0);
  });

  it('falls back to the wall when the held file cannot be stored', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockPartial([{ name: 'deck', cardCount: 21 }], 13);
    mockStorageUploadFile.mockRejectedValueOnce(new Error('no credentials'));
    const heldDeck = new InMemoryHeldDeckRepository();
    const req = buildEligibleRequest(TREATMENT_ID);
    const { res, capturedSend, redirectedTo } = responseWithRedirect();

    await serviceUnderTest(heldDeck).handleUpload(req, res);

    expect(redirectedTo()).toBe('/limit?kind=anonymous&cards=34');
    expect(capturedSend()).toBeNull();
    expect(heldDeck.rows).toHaveLength(0);
    expect(conversionFailedProps()).toMatchObject({
      reason: 'anonymous_cap',
      arm: 'treatment',
    });
  });

  it('refuses to charge usage when the claimed deck cannot be persisted', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockPartial([{ name: 'deck', cardCount: 21 }]);
    mockStorageUploadFile.mockRejectedValueOnce(new Error('no credentials'));
    const usersRepo = buildUsersRepo();
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo,
      ...fakeUploadServiceDeps({})
    );
    const heldFile = {
      fieldname: 'file',
      originalname: 'notes.html',
      encoding: '7bit',
      mimetype: 'application/octet-stream',
      size: 13,
      buffer: Buffer.from('<html></html>'),
      key: 'held/abc',
    } as unknown as Parameters<UploadService['convertHeldFileForOwner']>[1];

    await expect(
      service.convertHeldFileForOwner('4242', heldFile, false, null, 'req-1')
    ).rejects.toThrow('Could not persist the claimed deck');

    expect(usersRepo.incrementCardUsage).not.toHaveBeenCalled();
  });

  function heldSourceFile() {
    return {
      fieldname: 'file',
      originalname: 'notes.html',
      encoding: '7bit',
      mimetype: 'application/octet-stream',
      size: 13,
      buffer: Buffer.from('<html></html>'),
      key: 'held/abc',
    } as unknown as Parameters<UploadService['convertHeldFileForOwner']>[1];
  }

  it('cuts a preview-capped claim to 21 cards and saves the rest for a plan', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const execute = mockPartial([{ name: 'deck', cardCount: 21 }], 163);
    const heldDeck = new InMemoryHeldDeckRepository();
    const usersRepo = buildUsersRepo();
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo,
      ...fakeUploadServiceDeps({ heldDeck })
    );

    const result = await service.convertHeldFileForOwner(
      '4242',
      heldSourceFile(),
      false,
      null,
      'req-1',
      { previewCap: 21, heldCards: 184 }
    );

    expect(execute.mock.calls[0][6]).toMatchObject({ cardLimit: 21 });
    expect(result).toMatchObject({
      cardCount: 21,
      cardsHeldBack: 163,
      heldForPlan: true,
    });
    expect(heldDeck.rows).toHaveLength(1);
    expect(heldDeck.rows[0]).toMatchObject({
      anon_id: planHoldKey('4242'),
      filename: 'notes.html',
      card_count: 21,
      cards_held_back: 163,
    });
    expect(usersRepo.incrementCardUsage).toHaveBeenCalledWith(4242, 21);
  });

  it('cuts a preview-capped claim to what is left of the month when under 21', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const execute = mockPartial([{ name: 'deck', cardCount: 10 }], 174);
    const heldDeck = new InMemoryHeldDeckRepository();
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo({
        getCardUsage: vi
          .fn()
          .mockResolvedValue({ cards_used: 90, month_started_at: new Date() }),
      }),
      ...fakeUploadServiceDeps({ heldDeck })
    );

    const result = await service.convertHeldFileForOwner(
      '4242',
      heldSourceFile(),
      false,
      null,
      'req-1',
      { previewCap: 21, heldCards: 184 }
    );

    expect(execute.mock.calls[0][6]).toMatchObject({ cardLimit: 10 });
    expect(result).toMatchObject({ cardCount: 10, heldForPlan: true });
    expect(heldDeck.rows[0]).toMatchObject({ cards_held_back: 174 });
  });

  it('saves the deck for a pass before refusing a preview claim with no free cards left', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const execute = mockPartial([{ name: 'deck', cardCount: 184 }]);
    const heldDeck = new InMemoryHeldDeckRepository();
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo({
        getCardUsage: vi
          .fn()
          .mockResolvedValue({ cards_used: 100, month_started_at: new Date() }),
      }),
      ...fakeUploadServiceDeps({ heldDeck })
    );

    await expect(
      service.convertHeldFileForOwner(
        '4242',
        heldSourceFile(),
        false,
        null,
        'req-1',
        { previewCap: 21, heldCards: 184 }
      )
    ).rejects.toBeInstanceOf(MonthlyLimitError);

    expect(execute).not.toHaveBeenCalled();
    expect(heldDeck.rows).toHaveLength(1);
    expect(heldDeck.rows[0]).toMatchObject({
      anon_id: planHoldKey('4242'),
      card_count: 0,
      cards_held_back: 184,
    });
  });

  it('reports the preview as not saved when the plan hold cannot be stored', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockPartial([{ name: 'deck', cardCount: 21 }], 163);
    const heldDeck = new InMemoryHeldDeckRepository();
    vi.spyOn(heldDeck, 'insert').mockRejectedValueOnce(new Error('db down'));
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ heldDeck })
    );

    const result = await service.convertHeldFileForOwner(
      '4242',
      heldSourceFile(),
      false,
      null,
      'req-1',
      { previewCap: 21, heldCards: 184 }
    );

    expect(result).toMatchObject({ cardCount: 21, heldForPlan: false });
  });

  it('keeps the monthly allowance and saves no plan hold without a preview cap', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const execute = mockPartial([{ name: 'deck', cardCount: 100 }], 84);
    const heldDeck = new InMemoryHeldDeckRepository();
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps({ heldDeck })
    );

    const result = await service.convertHeldFileForOwner(
      '4242',
      heldSourceFile(),
      false,
      null,
      'req-1'
    );

    expect(execute.mock.calls[0][6]).toMatchObject({ cardLimit: 100 });
    expect(result).not.toHaveProperty('heldForPlan');
    expect(heldDeck.rows).toHaveLength(0);
  });

  it('leaves a treatment upload at or under 21 cards untouched', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    mockPartial([{ name: 'deck', cardCount: 21 }], 0);
    const req = buildEligibleRequest(TREATMENT_ID);
    const { res, capturedStatus } = buildResponse();

    await serviceUnderTest().handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(headerValue(res, 'X-Cards-Held-Back')).toBeUndefined();
    expect(exposedHeaders(res)).not.toContain('X-Cards-Held-Back');
    const props = conversionSucceededProps();
    expect(props).not.toHaveProperty('card_limit_partial');
    expect(props).not.toHaveProperty('arm');
  });

  it('does not refuse an over-cap upload from an anonymous pass holder when the flag is off', async () => {
    mockGetFeatureFlag.mockResolvedValue(false);
    mockPartial([{ name: 'deck', cardCount: 30 }]);
    const req = buildEligibleRequest(TREATMENT_ID);
    const { res, capturedStatus, redirectedTo } = responseWithRedirect();
    res.locals.subscriber = true;

    await serviceUnderTest().handleUpload(req, res);

    expect(redirectedTo()).toBeNull();
    expect(capturedStatus()).toBe(200);
  });

  it('delivers the whole deck to an anonymous visitor with a valid pass', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const execute = mockPartial([{ name: 'deck', cardCount: 30 }]);
    const req = buildEligibleRequest(TREATMENT_ID);
    const { res, capturedStatus, redirectedTo } = responseWithRedirect();
    res.locals.subscriber = true;

    await serviceUnderTest().handleUpload(req, res);

    expect(execute.mock.calls[0][6]).not.toHaveProperty('cardLimit');
    expect(redirectedTo()).toBeNull();
    expect(capturedStatus()).toBe(200);
    expect(headerValue(res, 'X-Cards-Held-Back')).toBeUndefined();
    const props = conversionSucceededProps();
    expect(props).not.toHaveProperty('card_limit_partial');
    expect(props).not.toHaveProperty('arm');
  });

  it('delivers an at-cap upload with no anonymous id unchanged with no held-back header', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const execute = mockPartial([{ name: 'deck', cardCount: 21 }]);
    const req = buildEligibleRequest();
    const { res, capturedStatus } = buildResponse();

    await serviceUnderTest().handleUpload(req, res);

    expect(execute.mock.calls[0][6]).not.toHaveProperty('cardLimit');
    expect(capturedStatus()).toBe(200);
    expect(headerValue(res, 'X-Cards-Held-Back')).toBeUndefined();
    const props = conversionSucceededProps();
    expect(props).not.toHaveProperty('card_limit_partial');
    expect(props).not.toHaveProperty('arm');
  });

  it('refuses an over-cap upload with no anonymous id with the arm and card-count bucket props', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const execute = mockPartial([{ name: 'deck', cardCount: 30 }]);
    const req = buildEligibleRequest();
    const { res, capturedSend, redirectedTo } = responseWithRedirect();

    await serviceUnderTest().handleUpload(req, res);

    expect(execute.mock.calls[0][6]).not.toHaveProperty('cardLimit');
    expect(redirectedTo()).toBe('/limit?kind=anonymous&cards=30');
    expect(capturedSend()).toBeNull();
    const props = conversionFailedProps();
    expect(props.reason).toBe('anonymous_cap');
    expect(props.arm).toBe('control');
    expect(props.card_count_bucket).toBeDefined();
  });

  it('puts a request with no anonymous id in the control arm', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const execute = mockPartial([{ name: 'deck', cardCount: 30 }]);
    const req = buildEligibleRequest();
    const { res, redirectedTo } = responseWithRedirect();

    await serviceUnderTest().handleUpload(req, res);

    expect(execute.mock.calls[0][6]).not.toHaveProperty('cardLimit');
    expect(redirectedTo()).toBe('/limit?kind=anonymous&cards=30');
    const props = conversionFailedProps();
    expect(props.reason).toBe('anonymous_cap');
    expect(props.arm).toBe('control');
  });

  it('keeps a multi-file upload on the refuse path with no arm even for a treatment id', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const execute = mockPartial([{ name: 'deck', cardCount: 30 }]);
    const req = buildRequest({
      files: [
        {
          originalname: 'week-one.html',
          mimetype: 'text/html',
          size: 1024,
          path: '/tmp/week-one.html',
        },
        {
          originalname: 'week-two.html',
          mimetype: 'text/html',
          size: 1024,
          path: '/tmp/week-two.html',
        },
      ],
    } as unknown as Partial<express.Request>);
    const { res, capturedSend, redirectedTo } = responseWithRedirect();

    await serviceUnderTest().handleUpload(req, res);

    expect(execute.mock.calls[0][6]).not.toHaveProperty('cardLimit');
    expect(redirectedTo()).toBe('/limit?kind=anonymous&cards=30');
    expect(capturedSend()).toBeNull();
    const props = conversionFailedProps();
    expect(props.reason).toBe('anonymous_cap');
    expect(props).not.toHaveProperty('arm');
  });

  it('walls a zip that did not truncate but tags the treatment arm', async () => {
    mockGetFeatureFlag.mockResolvedValue(true);
    const execute = mockPartial([{ name: 'deck', cardCount: 30 }]);
    const req = buildRequest({
      files: [
        {
          originalname: 'study-notes.zip',
          mimetype: 'application/zip',
          size: 1024,
          path: '/tmp/study-notes.zip',
          buffer: Buffer.from('PK\x03\x04 zip bytes'),
        },
      ],
      cookies: { anon_id: TREATMENT_ID },
    } as unknown as Partial<express.Request>);
    const { res, capturedSend, redirectedTo } = responseWithRedirect();

    await serviceUnderTest().handleUpload(req, res);

    expect(execute.mock.calls[0][6]).toMatchObject({
      cardLimit: ANONYMOUS_CARD_CAP,
    });
    expect(redirectedTo()).toBe('/limit?kind=anonymous&cards=30');
    expect(capturedSend()).toBeNull();
    const props = conversionFailedProps();
    expect(props.reason).toBe('anonymous_cap');
    expect(props.arm).toBe('treatment');
  });
});

describe('UploadService.respondToBrokenUpload', () => {
  function service() {
    return new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
  }

  it('records upload_incomplete with the multer error and answers the visitor', () => {
    trackMock.mockClear();
    const { res, capturedStatus, capturedJson } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    service().respondToBrokenUpload(
      buildRequest(),
      res,
      new Error('Unexpected end of form')
    );

    expect(capturedStatus()).toBe(400);
    expect(capturedJson()).toMatchObject({ code: 'upload_incomplete' });
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        userId: 42,
        props: expect.objectContaining({
          reason: 'upload_incomplete',
          upload_error: 'Error',
        }),
      })
    );
  });

  it('names a multer error by its code', () => {
    trackMock.mockClear();
    const { res } = buildResponse();
    const error = Object.assign(new Error('Unexpected field'), {
      code: 'LIMIT_UNEXPECTED_FILE',
    });

    service().respondToBrokenUpload(buildRequest(), res, error);

    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({
          upload_error: 'LIMIT_UNEXPECTED_FILE',
        }),
      })
    );
  });

  it('answers 500 and blames no connection when the disk write failed', () => {
    trackMock.mockClear();
    const { res, capturedStatus, capturedJson } = buildResponse();
    const error = Object.assign(new Error('no space left on device'), {
      code: 'ENOSPC',
    });

    service().respondToBrokenUpload(buildRequest(), res, error);

    expect(capturedStatus()).toBe(500);
    expect(capturedJson()).toMatchObject({ code: 'unknown' });
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({
          reason: 'upload_store_failed',
          upload_error: 'ENOSPC',
        }),
      })
    );
  });

  it('records client_left and answers nobody once the visitor has gone', () => {
    trackMock.mockClear();
    const { res, capturedStatus } = buildResponse();
    (res as unknown as { destroyed: boolean }).destroyed = true;

    service().respondToBrokenUpload(
      buildRequest(),
      res,
      new Error('Request closed')
    );

    expect(capturedStatus()).toBe(0);
    expect(trackMock).toHaveBeenCalledWith(
      'conversion_failed',
      expect.objectContaining({
        props: expect.objectContaining({ reason: 'client_left' }),
      })
    );
  });
});

describe('UploadService.handleSyncUpload — signed-in monthly partial delivery', () => {
  const originalWorkspaceBase = process.env.WORKSPACE_BASE;

  beforeAll(() => {
    process.env.WORKSPACE_BASE = path.join(os.tmpdir(), 'upload-service-test');
  });

  afterAll(() => {
    process.env.WORKSPACE_BASE = originalWorkspaceBase;
  });

  beforeEach(() => {
    MockGeneratePackagesUseCase.mockClear();
    trackMock.mockClear();
    mockFirstApkg = Buffer.from('fake-apkg');
    mockWorkspaceId = 'test-ws-id';
  });

  function usersRepoAt(cardsUsed: number): UsersRepository {
    return buildUsersRepo({
      getCardUsage: vi.fn().mockResolvedValue({
        cards_used: cardsUsed,
        month_started_at: new Date(),
      }),
    });
  }

  function singleFileRequest(originalname: string): express.Request {
    return buildRequest({
      files: [
        {
          originalname,
          mimetype: 'text/html',
          size: 1024,
          path: `/tmp/${originalname}`,
        },
      ],
    } as unknown as Partial<express.Request>);
  }

  function mockPartial(
    packages: Array<{ name: string; cardCount: number }>,
    cardsHeldBack?: number
  ) {
    const execute = vi
      .fn()
      .mockResolvedValue({ packages, warnings: [], cardsHeldBack });
    MockGeneratePackagesUseCase.mockImplementation(function () {
      return { execute } as unknown as InstanceType<
        typeof GeneratePackagesUseCase
      >;
    });
    return execute;
  }

  function responseWithRedirect() {
    const built = buildResponse();
    let redirectedTo: string | null = null;
    (built.res.redirect as unknown as Mock).mockImplementation(
      (url: string) => {
        redirectedTo = url;
        return built.res;
      }
    );
    return { ...built, redirectedTo: () => redirectedTo };
  }

  function headerValue(
    res: express.Response,
    name: string
  ): string | undefined {
    const call = (res.set as Mock).mock.calls.find(
      ([headerName]) => headerName === name
    );
    return call?.[1] as string | undefined;
  }

  function exposedHeaders(res: express.Response): string {
    return headerValue(res, 'Access-Control-Expose-Headers') ?? '';
  }

  function conversionSucceededProps(): Record<string, unknown> {
    const call = trackMock.mock.calls.find(
      ([name]) => name === 'conversion_succeeded'
    );
    return (call?.[1] as { props: Record<string, unknown> }).props;
  }

  function serviceUnderTest(
    usersRepo: UsersRepository,
    heldDeck?: InMemoryHeldDeckRepository
  ) {
    return new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo,
      ...fakeUploadServiceDeps(heldDeck ? { heldDeck } : {})
    );
  }

  function heldUploads() {
    return mockStorageUploadFile.mock.calls.filter(([key]) =>
      String(key).startsWith('held/')
    );
  }

  function partialRequestWithBytes(): express.Request {
    return buildRequest({
      files: [
        {
          originalname: 'study-notes.html',
          mimetype: 'text/html',
          size: 1024,
          path: '/tmp/study-notes.html',
          buffer: Buffer.from('<html>study notes</html>'),
        },
      ],
    } as unknown as Partial<express.Request>);
  }

  it('holds the source file under the owner for a week so a plan can unlock the full deck', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
    try {
      mockStorageUploadFile.mockClear();
      const usersRepo = usersRepoAt(MONTHLY_CARD_LIMIT - 10);
      mockPartial([{ name: 'deck', cardCount: 10 }], 5);
      const heldDeck = new InMemoryHeldDeckRepository();
      const { res, capturedStatus, capturedSend } = buildResponse();
      (res.locals as Record<string, unknown>).owner = 42;

      await serviceUnderTest(usersRepo, heldDeck).handleUpload(
        partialRequestWithBytes(),
        res
      );

      expect(capturedStatus()).toBe(200);
      expect(capturedSend()).toEqual(Buffer.from('fake-apkg'));
      expect(heldUploads()).toHaveLength(1);
      const [storageKey, bytes] = heldUploads()[0];
      expect(bytes).toEqual(Buffer.from('<html>study notes</html>'));
      expect(heldDeck.rows).toHaveLength(1);
      expect(heldDeck.rows[0]).toMatchObject({
        storage_key: storageKey,
        anon_id: 'plan:42',
        filename: 'study-notes.html',
        card_count: 10,
        cards_held_back: 5,
        claimed_at: null,
      });
      expect(heldDeck.rows[0].expires_at).toEqual(
        new Date('2026-10-25T12:00:00Z')
      );
      expect(headerValue(res, 'X-Held-For-Plan')).toBe('1');
      expect(exposedHeaders(res)).toContain('X-Held-For-Plan');
      expect(conversionSucceededProps()).toMatchObject({
        card_limit_partial: true,
        cards_held_back: 5,
        held_for_plan: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('still delivers the partial deck when the source cannot be held', async () => {
    mockStorageUploadFile.mockClear();
    mockStorageUploadFile.mockImplementation(async (key: string) => {
      if (key.startsWith('held/')) throw new Error('no credentials');
    });
    try {
      const usersRepo = usersRepoAt(MONTHLY_CARD_LIMIT - 10);
      mockPartial([{ name: 'deck', cardCount: 10 }], 5);
      const heldDeck = new InMemoryHeldDeckRepository();
      const { res, capturedStatus, capturedSend } = buildResponse();
      (res.locals as Record<string, unknown>).owner = 42;

      await serviceUnderTest(usersRepo, heldDeck).handleUpload(
        partialRequestWithBytes(),
        res
      );

      expect(capturedStatus()).toBe(200);
      expect(capturedSend()).toEqual(Buffer.from('fake-apkg'));
      expect(heldDeck.rows).toHaveLength(0);
      expect(headerValue(res, 'X-Held-For-Plan')).toBeUndefined();
      expect(conversionSucceededProps()).not.toHaveProperty('held_for_plan');
      expect(usersRepo.incrementCardUsage).toHaveBeenCalledWith(42, 10);
    } finally {
      mockStorageUploadFile.mockReset();
      mockStorageUploadFile.mockResolvedValue(undefined);
    }
  });

  it('holds nothing when the deck fits the remaining allowance', async () => {
    mockStorageUploadFile.mockClear();
    const usersRepo = usersRepoAt(MONTHLY_CARD_LIMIT - 10);
    mockPartial([{ name: 'deck', cardCount: 10 }], 0);
    const heldDeck = new InMemoryHeldDeckRepository();
    const { res } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await serviceUnderTest(usersRepo, heldDeck).handleUpload(
      partialRequestWithBytes(),
      res
    );

    expect(heldUploads()).toHaveLength(0);
    expect(heldDeck.rows).toHaveLength(0);
    expect(headerValue(res, 'X-Held-For-Plan')).toBeUndefined();
  });

  it('truncates a free user over their remaining allowance to a partial deck', async () => {
    const usersRepo = usersRepoAt(MONTHLY_CARD_LIMIT - 10);
    const execute = mockPartial([{ name: 'deck', cardCount: 10 }], 5);
    const req = singleFileRequest('study-notes.html');
    const { res, capturedStatus, capturedSend } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await serviceUnderTest(usersRepo).handleUpload(req, res);

    expect(execute.mock.calls[0][6]).toMatchObject({ cardLimit: 10 });
    expect(capturedStatus()).toBe(200);
    expect(capturedSend()).toEqual(Buffer.from('fake-apkg'));
    expect(headerValue(res, 'X-Card-Count')).toBe('10');
    expect(headerValue(res, 'X-Cards-Held-Back')).toBe('5');
    expect(exposedHeaders(res)).toContain('X-Cards-Held-Back');
    const props = conversionSucceededProps();
    expect(props).toMatchObject({
      card_limit_partial: true,
      cards_held_back: 5,
    });
    expect(props).not.toHaveProperty('arm');
    expect(usersRepo.incrementCardUsage).toHaveBeenCalledWith(42, 10);
    expect(trackMock).not.toHaveBeenCalledWith(
      'conversion_failed',
      expect.anything()
    );
    expect(trackMock).not.toHaveBeenCalledWith(
      'paywall_shown',
      expect.anything()
    );
  });

  it('leaves a deck that fits the remaining allowance untouched', async () => {
    const usersRepo = usersRepoAt(MONTHLY_CARD_LIMIT - 10);
    const execute = mockPartial([{ name: 'deck', cardCount: 10 }], 0);
    const req = singleFileRequest('study-notes.html');
    const { res, capturedStatus } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await serviceUnderTest(usersRepo).handleUpload(req, res);

    expect(execute.mock.calls[0][6]).toMatchObject({ cardLimit: 10 });
    expect(capturedStatus()).toBe(200);
    expect(headerValue(res, 'X-Cards-Held-Back')).toBeUndefined();
    expect(exposedHeaders(res)).not.toContain('X-Cards-Held-Back');
    const props = conversionSucceededProps();
    expect(props).not.toHaveProperty('card_limit_partial');
    expect(props).not.toHaveProperty('arm');
    expect(usersRepo.incrementCardUsage).toHaveBeenCalledWith(42, 10);
  });

  it('truncates a single zip export the same way as a single file', async () => {
    const usersRepo = usersRepoAt(MONTHLY_CARD_LIMIT - 10);
    const execute = mockPartial([{ name: 'deck', cardCount: 10 }], 5);
    const req = buildRequest({
      files: [
        {
          originalname: 'export.zip',
          mimetype: 'application/zip',
          size: 1024,
          path: '/tmp/export.zip',
        },
      ],
    } as unknown as Partial<express.Request>);
    const { res, capturedStatus } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await serviceUnderTest(usersRepo).handleUpload(req, res);

    expect(execute.mock.calls[0][6]).toMatchObject({ cardLimit: 10 });
    expect(capturedStatus()).toBe(200);
    expect(headerValue(res, 'X-Cards-Held-Back')).toBe('5');
    expect(usersRepo.incrementCardUsage).toHaveBeenCalledWith(42, 10);
  });

  it('still refuses a zip whose cards were not cut to the allowance', async () => {
    const usersRepo = usersRepoAt(MONTHLY_CARD_LIMIT - 10);
    mockPartial([{ name: 'deck', cardCount: 30 }], 0);
    const req = buildRequest({
      files: [
        {
          originalname: 'export.zip',
          mimetype: 'application/zip',
          size: 1024,
          path: '/tmp/export.zip',
        },
      ],
    } as unknown as Partial<express.Request>);
    const { res, capturedSend, redirectedTo } = responseWithRedirect();
    (res.locals as Record<string, unknown>).owner = 42;

    await serviceUnderTest(usersRepo).handleUpload(req, res);

    expect(redirectedTo()).toBe('/limit?kind=card_count');
    expect(capturedSend()).toBeNull();
    expect(usersRepo.incrementCardUsage).not.toHaveBeenCalled();
  });

  it('hard-refuses when the user has zero remaining allowance', async () => {
    const usersRepo = usersRepoAt(MONTHLY_CARD_LIMIT);
    const execute = mockPartial([{ name: 'deck', cardCount: 30 }]);
    const req = singleFileRequest('study-notes.html');
    const { res, capturedSend, redirectedTo } = responseWithRedirect();
    (res.locals as Record<string, unknown>).owner = 42;

    await serviceUnderTest(usersRepo).handleUpload(req, res);

    expect(execute.mock.calls[0][6]).not.toHaveProperty('cardLimit');
    expect(redirectedTo()).toBe('/limit?kind=card_count');
    expect(capturedSend()).toBeNull();
    expect(usersRepo.incrementCardUsage).not.toHaveBeenCalled();
    expect(trackMock).toHaveBeenCalledWith(
      'paywall_shown',
      expect.objectContaining({
        props: expect.objectContaining({ kind: 'card_count' }),
      })
    );
  });

  it.each([
    [
      'a multi-file upload',
      [
        {
          originalname: 'week-one.html',
          mimetype: 'text/html',
          size: 1024,
          path: '/tmp/week-one.html',
        },
        {
          originalname: 'week-two.html',
          mimetype: 'text/html',
          size: 1024,
          path: '/tmp/week-two.html',
        },
      ],
    ],
  ])(
    'keeps %s on the hard-refuse path with no cardLimit',
    async (_label, files) => {
      const usersRepo = usersRepoAt(MONTHLY_CARD_LIMIT - 10);
      const execute = mockPartial([{ name: 'deck', cardCount: 30 }]);
      const req = buildRequest({
        files,
      } as unknown as Partial<express.Request>);
      const { res, redirectedTo } = responseWithRedirect();
      (res.locals as Record<string, unknown>).owner = 42;

      await serviceUnderTest(usersRepo).handleUpload(req, res);

      expect(execute.mock.calls[0][6]).not.toHaveProperty('cardLimit');
      expect(redirectedTo()).toBe('/limit?kind=card_count');
    }
  );

  it('never truncates a paying user over the allowance', async () => {
    const usersRepo = usersRepoAt(MONTHLY_CARD_LIMIT * 2);
    const execute = mockPartial([{ name: 'deck', cardCount: 30 }]);
    const req = singleFileRequest('study-notes.html');
    const { res, capturedStatus } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;
    (res.locals as Record<string, unknown>).subscriber = true;

    await serviceUnderTest(usersRepo).handleUpload(req, res);

    expect(execute.mock.calls[0][6]).not.toHaveProperty('cardLimit');
    expect(capturedStatus()).toBe(200);
    expect(usersRepo.incrementCardUsage).toHaveBeenCalledWith(42, 30);
  });
});

describe('walkMediaFiles', () => {
  it('returns workspace-relative paths so nested media keep their folder', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-media-'));
    fs.mkdirSync(path.join(dir, 'folderA'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'root.png'), 'a');
    fs.writeFileSync(path.join(dir, 'folderA', 'image.png'), 'b');
    fs.writeFileSync(path.join(dir, 'page.html'), '<html></html>');
    fs.writeFileSync(path.join(dir, 'guids.json'), '[]');

    const media = walkMediaFiles(dir).sort();

    expect(media).toEqual(['folderA/image.png', 'root.png']);
  });
});
