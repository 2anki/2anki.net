import os from 'os';
import fs from 'node:fs';
import path from 'path';
import express from 'express';
import knex, { Knex } from 'knex';

jest.mock('../usecases/uploads/GeneratePackagesUseCase', () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

const mockGenerateDeckInfo = jest.fn();
jest.mock('../lib/claude/ClaudeService', () => ({
  ...jest.requireActual('../lib/claude/ClaudeService'),
  generateDeckInfo: (...args: unknown[]) => mockGenerateDeckInfo(...args),
}));

jest.mock('../lib/integrations/stripe', () => ({
  getStripe: jest.fn().mockReturnValue({
    customers: { retrieve: jest.fn() },
  }),
  updateStoreSubscription: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/SubscriptionService', () => ({
  __esModule: true,
  default: { findActiveStripeSubscriptions: jest.fn().mockResolvedValue([]) },
}));

jest.mock('./events/track', () => ({ track: jest.fn() }));

let mockWorkspaceLocation = '';
let mockWorkspaceId = 'test-ws-id';
let mockFirstApkg: Buffer | null = null;
jest.mock('../lib/parser/WorkSpace', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      get id() {
        return mockWorkspaceId;
      },
      get location() {
        return mockWorkspaceLocation;
      },
      getFirstAPKG: () => Promise.resolve(mockFirstApkg),
    })),
  };
});

jest.mock('../lib/parser/exporters/CustomExporter', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    configure: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
  })),
}));

const mockStorageDelete = jest.fn().mockResolvedValue(true);
const mockStorageUploadFile = jest.fn().mockResolvedValue(undefined);
const mockStorageUniqify = jest.fn().mockReturnValue('test-key.apkg');
jest.mock('../lib/storage/StorageHandler', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      delete: mockStorageDelete,
      uploadFile: mockStorageUploadFile,
      uniqify: mockStorageUniqify,
    })),
  };
});

import GeneratePackagesUseCase from '../usecases/uploads/GeneratePackagesUseCase';
import { EmptyDeckError } from '../usecases/jobs/EmptyDeckError';
import { DeckTooLargeError } from '../lib/parser/exporters/DeckTooLargeError';
import UploadService from './UploadService';
import { track } from './events/track';

const trackMock = track as jest.Mock;
import { IUploadRepository } from '../data_layer/UploadRespository';
import JobRepository from '../data_layer/JobRepository';
import UsersRepository from '../data_layer/UsersRepository';
import { ISettingsRepository } from '../data_layer/SettingsRepository';
import Uploads from '../data_layer/public/Uploads';

const MockGeneratePackagesUseCase = GeneratePackagesUseCase as jest.MockedClass<
  typeof GeneratePackagesUseCase
>;

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
    getCardUsage: jest
      .fn()
      .mockResolvedValue({ cards_used: 0, month_started_at: new Date() }),
    incrementCardUsage: jest.fn().mockResolvedValue(1),
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

  const jsonFn = jest.fn((body: unknown) => {
    json = body;
    return res; // eslint-disable-line @typescript-eslint/no-use-before-define
  });
  const statusFn = jest.fn((code: number) => {
    status = code;
    return res; // eslint-disable-line @typescript-eslint/no-use-before-define
  });
  const setFn = jest.fn(() => res); // eslint-disable-line @typescript-eslint/no-use-before-define
  const sendFn = jest.fn((body: unknown) => {
    sent = body;
    return res; // eslint-disable-line @typescript-eslint/no-use-before-define
  });
  const contentTypeFn = jest.fn(() => res); // eslint-disable-line @typescript-eslint/no-use-before-define
  const attachmentFn = jest.fn(() => res); // eslint-disable-line @typescript-eslint/no-use-before-define
  const redirectFn = jest.fn(() => res); // eslint-disable-line @typescript-eslint/no-use-before-define

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
  });

  it('emits upload_started and conversion_failed sharing the anonymous_id from the cookie', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({ packages: [] }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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

  it('attaches the saved custom templates for a signed-in upload before generating packages', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({ packages: [] }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const attachCustomTemplates = jest.fn().mockResolvedValue(undefined);
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      {
        attachCustomTemplates,
      } as unknown as ISettingsRepository
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
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({ packages: [] }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const attachCustomTemplates = jest.fn().mockResolvedValue(undefined);
    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo(),
      {
        attachCustomTemplates,
      } as unknown as ISettingsRepository
    );
    const req = buildRequest({
      body: { template: 'custom' },
    } as Partial<express.Request>);
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(attachCustomTemplates).not.toHaveBeenCalled();
  });

  it('attributes source=dropbox when the request lands on the dropbox path with no explicit source', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({ packages: [] }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({ packages: [] }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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

  it('returns image_only_no_text with a Photo to Deck link when an image-only upload yields 0 cards', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({ packages: [] }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({ packages: [] }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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

  it('EmptyDeckError response body contains no HTML tags', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({ packages: [] }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
    );
    const req = buildRequest();
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    const body = capturedJson() as { message: string };
    expect(body.message).not.toMatch(/<[a-z]/i);
  });

  it('uses in-memory uploaded file contents for empty-deck diagnostics when no disk path exists', async () => {
    const infoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      MockGeneratePackagesUseCase.mockImplementation(
        () =>
          ({
            execute: jest.fn().mockResolvedValue({ packages: [] }),
          }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
      );

      const service = new UploadService(
        buildRepository(),
        {} as JobRepository,
        buildUsersRepo()
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
        expect.stringContaining('<details>')
      );
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('returns 400 JSON when deck serialization overflows (DeckTooLargeError path)', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockRejectedValue(new DeckTooLargeError()),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockRejectedValue(new DeckTooLargeError()),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
    );
    const req = buildRequest();
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    const body = capturedJson() as { message: string };
    expect(body.message).not.toMatch(/at .*\(/);
    expect(body.message).not.toMatch(/RangeError/);
  });

  it('returns 400 with code docx_processing_failed when convertDocxToHTML throws a docx_parse_failed error', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest
            .fn()
            .mockRejectedValue(
              new Error(
                'docx_parse_failed: Could not find the body element: are you sure this is a docx file?'
              )
            ),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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

  it('rejects .apkg upload with 400 and the "already an Anki deck" message before reaching GeneratePackagesUseCase', async () => {
    const executeMock = jest.fn();
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: executeMock,
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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
    packages: Array<{ name: string; cardCount: number }>,
    warnings?: string[]
  ) {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({ packages, warnings }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );
  }

  function responseWithRedirect() {
    const built = buildResponse();
    let redirectedTo: string | null = null;
    (built.res.redirect as unknown as jest.Mock).mockImplementation(
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
      buildUsersRepo()
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

  it('redirects a logged-in free user over the monthly limit to /limit?kind=card_count and does not send the deck', async () => {
    mockPackages([{ name: 'deck', cardCount: 30 }]);
    const usersRepo = buildUsersRepo({
      getCardUsage: jest
        .fn()
        .mockResolvedValue({ cards_used: 80, month_started_at: new Date() }),
    });
    const incrementSpy = usersRepo.incrementCardUsage as jest.Mock;

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo
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

  it('sends the deck and increments card usage for a logged-in free user under the limit', async () => {
    mockPackages([{ name: 'deck', cardCount: 30 }]);
    const usersRepo = buildUsersRepo({
      getCardUsage: jest
        .fn()
        .mockResolvedValue({ cards_used: 10, month_started_at: new Date() }),
    });
    const incrementSpy = usersRepo.incrementCardUsage as jest.Mock;

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo
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
    const incrementSpy = usersRepo.incrementCardUsage as jest.Mock;

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo
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

  it('treats an authenticated request whose owner is unresolved as a logged-in limit, not anonymous', async () => {
    mockPackages([{ name: 'deck', cardCount: 22 }]);
    const usersRepo = buildUsersRepo();

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo
    );
    const req = buildRequest({
      cookies: { token: 'a-valid-session-token' },
    } as Partial<express.Request>);
    const { res, capturedSend, redirectedTo } = responseWithRedirect();

    await service.handleUpload(req, res);

    expect(redirectedTo()).toBe('/limit?kind=card_count');
    expect(capturedSend()).toBeNull();
  });

  it('sets X-Dropped-Assets to the summed dropped-image count across packages on a single-deck sync upload', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
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
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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
      buildUsersRepo()
    );
    const req = buildRequest();
    const { res } = buildResponse();

    await service.handleUpload(req, res);

    expect(res.set).not.toHaveBeenCalledWith(
      'X-Dropped-Assets',
      expect.anything()
    );
  });

  it('sets X-Expired-Notion-Assets to the summed expired-image count on a single-deck sync upload', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
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
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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
      buildUsersRepo()
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
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
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
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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
      buildUsersRepo()
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
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
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
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
    );
    const req = buildRequest();
    const { res, capturedStatus } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(res.set).toHaveBeenCalledWith('X-Structure-Rescued', 'heading');
  });

  it('does not set X-Structure-Rescued when the rescue was rejected', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
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
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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
      buildUsersRepo()
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
      usersRepo
    );
    const req = buildRequest();
    const { res, capturedStatus } = buildResponse();

    await service.handleUpload(req, res);

    expect(capturedStatus()).toBe(200);
    expect(res.set).toHaveBeenCalledWith('X-Warning', lockedWarning);
  });

  it('sends the deck for an anonymous conversion at or under 21 cards without incrementing usage', async () => {
    mockPackages([{ name: 'deck', cardCount: 21 }]);
    const usersRepo = buildUsersRepo();
    const incrementSpy = usersRepo.incrementCardUsage as jest.Mock;

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo
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
    const incrementSpy = usersRepo.incrementCardUsage as jest.Mock;

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo
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
      buildUsersRepo()
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
  let infoSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

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
    infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function zeroCardUseCase() {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({ packages: [] }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );
  }

  function jobRepositoryWithFailedGate(onFailed?: () => void): JobRepository {
    return {
      create: jest.fn().mockResolvedValue(undefined),
      updateJobStatus: jest
        .fn()
        .mockImplementation((_id: string, _owner: string, status: string) => {
          if (status === 'failed') {
            onFailed?.();
          }
          return Promise.resolve(undefined);
        }),
      findJobById: jest.fn().mockResolvedValue(null),
      deleteJob: jest.fn().mockResolvedValue(undefined),
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
      buildUsersRepo()
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
      buildUsersRepo()
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
      buildUsersRepo()
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
      buildUsersRepo()
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
      buildUsersRepo()
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
      buildUsersRepo()
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
      buildUsersRepo()
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
      findByKey: jest.fn().mockResolvedValue({
        id: 1,
        owner: 7,
        key: 'k.apkg',
        filename: 'k.apkg',
        object_id: 'obj-123',
        size_mb: 1,
        created_at: new Date(),
      } as Uploads),
      deleteUpload: jest.fn().mockResolvedValue(1),
    };
    const jobRepository = {
      deleteJobByObjectId: jest.fn().mockResolvedValue(1),
    } as unknown as JobRepository;

    const service = new UploadService(repo, jobRepository, buildUsersRepo());
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
      findByKey: jest.fn().mockResolvedValue({
        id: 1,
        owner: 7,
        key: 'k.apkg',
        filename: 'k.apkg',
        object_id: null,
        size_mb: 1,
        created_at: new Date(),
      } as Uploads),
      deleteUpload: jest.fn().mockResolvedValue(1),
    };
    const jobRepository = {
      deleteJobByObjectId: jest.fn(),
    } as unknown as JobRepository;

    const service = new UploadService(repo, jobRepository, buildUsersRepo());
    await service.deleteUpload(7, 'k.apkg');

    expect(repo.deleteUpload).toHaveBeenCalledWith(7, 'k.apkg');
    expect(mockStorageDelete).toHaveBeenCalledWith('k.apkg');
    expect(jobRepository.deleteJobByObjectId).not.toHaveBeenCalled();
  });

  it('skips the job delete when no matching upload row exists', async () => {
    const repo: IUploadRepository = {
      ...buildRepository(),
      findByKey: jest.fn().mockResolvedValue(null),
      deleteUpload: jest.fn().mockResolvedValue(0),
    };
    const jobRepository = {
      deleteJobByObjectId: jest.fn(),
    } as unknown as JobRepository;

    const service = new UploadService(repo, jobRepository, buildUsersRepo());
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
      update: jest.fn().mockResolvedValue([]),
    };
    const jobRepository = {
      create: jest.fn().mockResolvedValue(undefined),
      updateJobStatus: jest.fn().mockResolvedValue(undefined),
      findJobById: jest.fn().mockResolvedValue(null),
      deleteJob: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;

    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
            packages: [
              {
                name: 'my-deck',
                cardCount: 5,
                mcqCount: 0,
                mcqSkippedCount: 0,
              },
            ],
          }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(repo, jobRepository, buildUsersRepo());
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
      update: jest.fn().mockResolvedValue([]),
    };
    const jobRepository = {
      create: jest.fn().mockResolvedValue(undefined),
      updateJobStatus: jest.fn().mockResolvedValue(undefined),
      findJobById: jest.fn().mockImplementation(() => {
        resolveFind();
        return Promise.resolve(null);
      }),
      deleteJob: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;

    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
            packages: [{ name: 'my-deck', cardCount: 7 }],
          }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(repo, jobRepository, buildUsersRepo());
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
        props: expect.objectContaining({ card_count_bucket: '<50' }),
      })
    );
  });

  async function runAsyncUploadWithBody(
    body: Record<string, unknown>
  ): Promise<jest.Mock> {
    fs.writeFileSync(path.join(tmpDir, 'my-deck.apkg'), Buffer.from('apkg'));

    let resolveUpdate!: () => void;
    const updateCalled = new Promise<void>((r) => {
      resolveUpdate = r;
    });
    const updateMock = jest.fn().mockImplementation(() => {
      resolveUpdate();
      return Promise.resolve([]);
    });
    const repo: IUploadRepository = {
      ...buildRepository(),
      update: updateMock,
    };
    const jobRepository = {
      create: jest.fn().mockResolvedValue(undefined),
      updateJobStatus: jest.fn().mockResolvedValue(undefined),
      findJobById: jest.fn().mockResolvedValue(null),
      deleteJob: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;

    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
            packages: [
              {
                name: 'my-deck',
                cardCount: 5,
                mcqCount: 0,
                mcqSkippedCount: 0,
              },
            ],
          }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(repo, jobRepository, buildUsersRepo());
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

  async function runAsyncUploadThatRejects(
    rejection: unknown
  ): Promise<jest.Mock> {
    let resolveFailed!: () => void;
    const failedRecorded = new Promise<void>((r) => {
      resolveFailed = r;
    });
    const updateJobStatusMock = jest
      .fn()
      .mockImplementation((_id: string, _owner: string, status: string) => {
        if (status === 'failed') {
          resolveFailed();
        }
        return Promise.resolve(undefined);
      });
    const jobRepository = {
      create: jest.fn().mockResolvedValue(undefined),
      updateJobStatus: updateJobStatusMock,
      findJobById: jest.fn().mockResolvedValue(null),
      deleteJob: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;

    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockRejectedValue(rejection),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      jobRepository,
      buildUsersRepo()
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
    const updateJobStatusMock = jest
      .fn()
      .mockImplementation((_id: string, _owner: string, status: string) => {
        if (status === 'failed') {
          resolveFailed();
        }
        return Promise.resolve(undefined);
      });
    const jobRepository = {
      create: jest.fn().mockResolvedValue(undefined),
      updateJobStatus: updateJobStatusMock,
      findJobById: jest.fn().mockResolvedValue(null),
      deleteJob: jest.fn().mockResolvedValue(undefined),
    } as unknown as JobRepository;
    const updateSpy = jest.fn().mockResolvedValue([]);
    const repo: IUploadRepository = {
      ...buildRepository(),
      update: updateSpy,
    };

    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
            packages: [
              {
                name: 'my-deck',
                cardCount: 0,
                mcqCount: 0,
                mcqSkippedCount: 0,
              },
            ],
          }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(repo, jobRepository, buildUsersRepo());
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
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
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
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
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
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
    );
    const req = buildRequest();
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    const body = capturedJson() as { droppedImageCount?: number };
    expect(body.droppedImageCount).toBe(3);
  });

  it('omits droppedImageCount from the batch JSON when no images were dropped', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
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
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
    );
    const req = buildRequest();
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    const body = capturedJson() as { droppedImageCount?: number };
    expect(body.droppedImageCount).toBeUndefined();
  });

  it('includes expiredNotionImageCount in the batch JSON when Notion images expired across the batch', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
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
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
    );
    const req = buildRequest();
    const { res, capturedJson } = buildResponse();

    await service.handleUpload(req, res);

    const body = capturedJson() as { expiredNotionImageCount?: number };
    expect(body.expiredNotionImageCount).toBe(3);
  });

  it('omits expiredNotionImageCount from the batch JSON when no Notion images expired', async () => {
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
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
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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
    const service = new UploadService(repo, jobRepository, buildUsersRepo());

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
    const service = new UploadService(repo, jobRepository, buildUsersRepo());

    const { res, capturedStatus } = buildResponse();
    (res.locals as Record<string, unknown>).owner = 42;

    await service.restartClaudeJob(buildRestartRequest(), res);

    expect(mockGenerateDeckInfo).not.toHaveBeenCalled();
    expect(capturedStatus()).toBe(409);
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
      buildUsersRepo()
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
      buildUsersRepo()
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

    expect(args[1]).toEqual([]);
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
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest.fn().mockResolvedValue({
            packages: [{ name: 'deck', cardCount: 30 }],
          }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );
  });

  function buildJobRepo(): { repo: JobRepository; create: jest.Mock } {
    const create = jest.fn().mockResolvedValue(undefined);
    return {
      repo: {
        create,
        updateJobStatus: jest.fn().mockResolvedValue(undefined),
        findJobById: jest.fn().mockResolvedValue(null),
        deleteJob: jest.fn().mockResolvedValue(undefined),
      } as unknown as JobRepository,
      create,
    };
  }

  it('routes a free user with the claude flag through the sync path and enforces the limit', async () => {
    const usersRepo = buildUsersRepo({
      getCardUsage: jest
        .fn()
        .mockResolvedValue({ cards_used: 80, month_started_at: new Date() }),
    });
    const incrementSpy = usersRepo.incrementCardUsage as jest.Mock;
    const { repo: jobRepo, create } = buildJobRepo();

    const service = new UploadService(buildRepository(), jobRepo, usersRepo);
    const req = buildRequest({ body: { 'claude-ai-flashcards': 'true' } });
    const built = buildResponse();
    let redirectedTo: string | null = null;
    (built.res.redirect as unknown as jest.Mock).mockImplementation(
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
      getCardUsage: jest
        .fn()
        .mockResolvedValue({ cards_used: 10, month_started_at: new Date() }),
    });
    const incrementSpy = usersRepo.incrementCardUsage as jest.Mock;
    const { repo: jobRepo, create } = buildJobRepo();

    const service = new UploadService(buildRepository(), jobRepo, usersRepo);
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

    const service = new UploadService(buildRepository(), jobRepo, usersRepo);
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

      const service = new UploadService(buildRepository(), jobRepo, usersRepo);
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
      getCardUsage: jest
        .fn()
        .mockResolvedValue({ cards_used: 80, month_started_at: new Date() }),
    });
    const incrementSpy = usersRepo.incrementCardUsage as jest.Mock;

    const service = new UploadService(
      buildRepository(),
      new JobRepository(db),
      usersRepo
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
    MockGeneratePackagesUseCase.mockImplementation(
      () =>
        ({
          execute: jest
            .fn()
            .mockResolvedValue({ packages: [{ name: 'deck', cardCount }] }),
        }) as unknown as InstanceType<typeof GeneratePackagesUseCase>
    );
  }

  function firstTouchCookie(landingPath: string) {
    return JSON.stringify({ landingPath });
  }

  it('stamps the resolved signup_origin on upload_started and conversion_succeeded from the first_touch cookie', async () => {
    mockSingleDeck(12);

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      buildUsersRepo()
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
      getCardUsage: jest
        .fn()
        .mockResolvedValue({ cards_used: 80, month_started_at: new Date() }),
    });

    const service = new UploadService(
      buildRepository(),
      {} as JobRepository,
      usersRepo
    );
    const req = buildRequest({
      cookies: { first_touch: firstTouchCookie('/photo-to-deck') },
    } as Partial<express.Request>);
    const { res } = buildResponse();
    (res.redirect as unknown as jest.Mock).mockReturnValue(res);
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
      buildUsersRepo()
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
