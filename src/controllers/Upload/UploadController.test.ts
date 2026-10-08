import { vi, type Mock } from 'vitest';
import express from 'express';
import multer from 'multer';

vi.mock('../../lib/misc/GetUploadHandler');

vi.mock('../../lib/integrations/stripe', () => ({
  getStripe: vi.fn().mockReturnValue({
    customers: { retrieve: vi.fn() },
  }),
  updateStoreSubscription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/SubscriptionService', () => ({
  __esModule: true,
  default: { findActiveStripeSubscriptions: vi.fn().mockResolvedValue([]) },
}));

import { getUploadHandler } from '../../lib/misc/GetUploadHandler';
import { INotionRepository } from '../../data_layer/NotionRespository';
import { IUploadRepository } from '../../data_layer/UploadRespository';
import NotionTokens from '../../data_layer/public/NotionTokens';
import Uploads from '../../data_layer/public/Uploads';
import NotionService from '../../services/NotionService';
import UploadService from '../../services/UploadService';
import JobRepository from '../../data_layer/JobRepository';
import UsersRepository from '../../data_layer/UsersRepository';
import UploadController from './UploadController';
import { fakeUploadServiceDeps } from '../../test/fakes/uploadServiceDeps';

function buildUsersRepo(): UsersRepository {
  return {
    getCardUsage: vi
      .fn()
      .mockResolvedValue({ cards_used: 0, month_started_at: new Date() }),
    incrementCardUsage: vi.fn().mockResolvedValue(1),
  } as unknown as UsersRepository;
}

describe('Upload file', () => {
  test('upload failed is caught', () => {
    // Arrange
    const repository: IUploadRepository = {
      deleteUpload: function (owner: number, _key: string): Promise<number> {
        return Promise.resolve(1);
      },
      getUploadsByOwner: function (owner: number): Promise<Uploads[]> {
        return Promise.resolve([]);
      },
      findByIdAndOwner: function (
        _id: number,
        _owner: number
      ): Promise<Uploads | null> {
        return Promise.resolve(null);
      },
      findByObjectId: function (_objectId: string): Promise<Uploads | null> {
        return Promise.resolve(null);
      },
      findByKey: function (
        _owner: number,
        _key: string
      ): Promise<Uploads | null> {
        return Promise.resolve(null);
      },
      findAllByObjectIdAndOwner: function (
        _objectId: string,
        _owner: number
      ): Promise<Uploads[]> {
        return Promise.resolve([]);
      },
      update: function (
        owner: number,
        filename: string,
        key: string,
        size_mb: number
      ): Promise<Uploads[]> {
        return Promise.resolve([]);
      },
      getLastUploadForUser: function (_userId: number) {
        return Promise.resolve(null);
      },
      getLastReconvertibleUpload: function (_userId: number) {
        return Promise.resolve(null);
      },
      findByOwnerAndDedupeKey: function (
        _owner: number,
        _dedupeKey: string
      ): Promise<Uploads | null> {
        return Promise.resolve(null);
      },
      insertNativeDeck: function (): Promise<Uploads> {
        return Promise.reject(new Error('not implemented'));
      },
      insertConvertedDeck: function (): Promise<Uploads> {
        return Promise.reject(new Error('not implemented'));
      },
    };
    const notionRepository: INotionRepository = {
      getNotionData: function (owner: string | number): Promise<NotionTokens> {
        return Promise.resolve({ owner: 1, token: '...' } as NotionTokens);
      },
      saveNotionToken: function (
        user: number,
        data: { [key: string]: string },
        hash: (token: string) => string
      ): Promise<boolean> {
        return Promise.resolve(true);
      },
      getNotionToken: function (owner: string): Promise<string> {
        return Promise.resolve('...');
      },
      deleteBlocksByOwner: function (owner: number): Promise<number> {
        return Promise.resolve(owner);
      },
      deleteNotionData(owner: number): Promise<boolean> {
        return Promise.resolve(true);
      },
      markTokenInvalid: vi.fn().mockResolvedValue(undefined),
      clearTokenInvalid: vi.fn().mockResolvedValue(undefined),
      setReconnectEmailSent: vi.fn().mockResolvedValue(true),
    };
    const uploadService = new UploadService(
      repository,
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const notionService = new NotionService(notionRepository);
    const uploadController = new UploadController(uploadService, notionService);

    // Act
    const jsonSpy = vi.fn();
    let capturedStatus = 0;

    // Assert
    uploadController.file(
      {} as express.Request,
      {
        status: (code: number) => {
          capturedStatus = code;
          return { json: jsonSpy } as unknown as express.Response;
        },
      } as unknown as express.Response
    );

    expect(capturedStatus).toBe(400);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });
});

describe('Upload file — multer error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test.each([
    // `.array('pakker', 21)` reports the 22nd file this way (multer index.js).
    new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'pakker'),
    // `limits.files`, if it were ever set, reports it this way.
    new multer.MulterError('LIMIT_FILE_COUNT'),
  ])(
    'returns 400 with code=too_many_files on the multer count error %s, without converting',
    async (multerError) => {
      // multer has already deleted every temp file by the time it reports the
      // count limit; running the conversion on the dead placeholders used to
      // answer "your upload didn't finish" instead of naming the cap.
      (getUploadHandler as Mock).mockImplementation(
        () =>
          (
            req: express.Request,
            _res: express.Response,
            cb: (err?: unknown) => void
          ) => {
            req.files = [{ path: '/gone/1' }, { path: '/gone/2' }] as never;
            cb(multerError);
          }
      );

      const uploadService = new UploadService(
        {} as IUploadRepository,
        {} as JobRepository,
        buildUsersRepo(),
        ...fakeUploadServiceDeps()
      );
      const handleUpload = vi
        .spyOn(uploadService, 'handleUpload')
        .mockResolvedValue(undefined);
      const notionService = new NotionService({} as INotionRepository);
      const controller = new UploadController(uploadService, notionService);

      const jsonSpy = vi.fn();
      let capturedStatus = 0;
      await new Promise<void>((resolve) => {
        const fakeRes = {
          locals: { patreon: false, subscriber: false },
          status: (code: number) => {
            capturedStatus = code;
            return {
              json: (body: unknown) => {
                jsonSpy(body);
                resolve();
              },
            };
          },
        } as unknown as express.Response;
        controller.file({} as express.Request, fakeRes);
      });

      expect(capturedStatus).toBe(400);
      expect(jsonSpy).toHaveBeenCalledWith({
        code: 'too_many_files',
        message: expect.stringContaining('21'),
      });
      expect(handleUpload).not.toHaveBeenCalled();
    }
  );

  test('a stray field name is not the file cap and still reaches the service', async () => {
    (getUploadHandler as Mock).mockImplementation(
      () =>
        (
          _req: express.Request,
          _res: express.Response,
          cb: (err?: unknown) => void
        ) => {
          cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'avatar'));
        }
    );
    const uploadService = new UploadService(
      {} as IUploadRepository,
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const handleUpload = vi
      .spyOn(uploadService, 'handleUpload')
      .mockResolvedValue(undefined);
    const controller = new UploadController(
      uploadService,
      new NotionService({} as INotionRepository)
    );

    controller.file(
      {} as express.Request,
      {
        locals: {},
      } as unknown as express.Response
    );
    await new Promise((r) => setImmediate(r));

    expect(handleUpload).toHaveBeenCalledTimes(1);
  });

  test('returns 413 with code=too_large when multer LIMIT_FILE_SIZE fires', async () => {
    const multerError = new multer.MulterError('LIMIT_FILE_SIZE');
    (getUploadHandler as Mock).mockImplementation(
      () =>
        (
          _req: express.Request,
          _res: express.Response,
          cb: (err?: unknown) => void
        ) => {
          cb(multerError);
        }
    );

    const jsonSpy = vi.fn();
    let capturedStatus = 0;

    const repository = {
      deleteUpload: vi.fn(),
      getUploadsByOwner: vi.fn().mockResolvedValue([]),
      findByIdAndOwner: vi.fn().mockResolvedValue(null),
      findByObjectId: vi.fn().mockResolvedValue(null),
      findByKey: vi.fn().mockResolvedValue(null),
      findAllByObjectIdAndOwner: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue([]),
      getLastUploadForUser: vi.fn().mockResolvedValue(null),
      getLastReconvertibleUpload: vi.fn().mockResolvedValue(null),
      findByOwnerAndDedupeKey: vi.fn().mockResolvedValue(null),
      insertNativeDeck: vi.fn(),
      insertConvertedDeck: vi.fn(),
    };
    const notionRepository: INotionRepository = {
      getNotionData: vi.fn() as INotionRepository['getNotionData'],
      saveNotionToken: vi.fn() as INotionRepository['saveNotionToken'],
      getNotionToken: vi.fn() as INotionRepository['getNotionToken'],
      deleteBlocksByOwner: vi.fn() as INotionRepository['deleteBlocksByOwner'],
      deleteNotionData: vi.fn() as INotionRepository['deleteNotionData'],
      markTokenInvalid: vi.fn().mockResolvedValue(undefined),
      clearTokenInvalid: vi.fn().mockResolvedValue(undefined),
      setReconnectEmailSent: vi.fn().mockResolvedValue(true),
    };
    const uploadService = new UploadService(
      repository,
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const notionService = new NotionService(notionRepository);
    const controller = new UploadController(uploadService, notionService);

    await new Promise<void>((resolve) => {
      const fakeRes = {
        locals: {},
        status: (code: number) => {
          capturedStatus = code;
          return {
            json: (body: unknown) => {
              jsonSpy(body);
              resolve();
            },
          };
        },
      } as unknown as express.Response;
      controller.file({} as express.Request, fakeRes);
    });

    expect(capturedStatus).toBe(413);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'too_large',
        // Plan-neutral copy: the cap differs per tier (100MB free, larger for
        // paying), so the message must not hardcode a number.
        message: expect.stringContaining('size limit'),
      })
    );
  });
});

describe('UploadController.retryPdfWithCredential rate limit', () => {
  test('returns 429 when the limiter rejects the IP', async () => {
    const repository = {
      deleteUpload: vi.fn(),
      getUploadsByOwner: vi.fn().mockResolvedValue([]),
      findByIdAndOwner: vi.fn().mockResolvedValue(null),
      findByObjectId: vi.fn().mockResolvedValue(null),
      findByKey: vi.fn().mockResolvedValue(null),
      findAllByObjectIdAndOwner: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue([]),
      getLastUploadForUser: vi.fn().mockResolvedValue(null),
      getLastReconvertibleUpload: vi.fn().mockResolvedValue(null),
      findByOwnerAndDedupeKey: vi.fn().mockResolvedValue(null),
      insertNativeDeck: vi.fn(),
      insertConvertedDeck: vi.fn(),
    };
    const notionRepository: INotionRepository = {
      getNotionData: vi.fn() as INotionRepository['getNotionData'],
      saveNotionToken: vi.fn() as INotionRepository['saveNotionToken'],
      getNotionToken: vi.fn() as INotionRepository['getNotionToken'],
      deleteBlocksByOwner: vi.fn() as INotionRepository['deleteBlocksByOwner'],
      deleteNotionData: vi.fn() as INotionRepository['deleteNotionData'],
      markTokenInvalid: vi.fn().mockResolvedValue(undefined),
      clearTokenInvalid: vi.fn().mockResolvedValue(undefined),
      setReconnectEmailSent: vi.fn().mockResolvedValue(true),
    };
    const uploadService = new UploadService(
      repository,
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const notionService = new NotionService(notionRepository);

    const blockingLimiter = { check: vi.fn().mockReturnValue(false) };
    const controller = new UploadController(
      uploadService,
      notionService,
      undefined,
      undefined,
      undefined,
      undefined,
      blockingLimiter
    );

    const jsonSpy = vi.fn();
    let capturedStatus = 0;
    const capturedHeaders: Record<string, string> = {};

    const req = {
      file: {
        path: '/tmp/does-not-need-to-exist.pdf',
        originalname: 'foo.pdf',
      },
      body: {},
      headers: { 'x-forwarded-for': '10.0.0.1' },
      socket: { remoteAddress: '10.0.0.1' },
    } as unknown as express.Request;

    const res = {
      locals: {},
      set: (name: string, value: string) => {
        capturedHeaders[name] = value;
        return res;
      },
      status: (code: number) => {
        capturedStatus = code;
        return { json: jsonSpy } as unknown as express.Response;
      },
    } as unknown as express.Response;

    await controller.retryPdfWithCredential(req, res);

    expect(blockingLimiter.check).toHaveBeenCalledTimes(1);
    expect(capturedStatus).toBe(429);
    expect(capturedHeaders['Retry-After']).toBe('60');
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Too many password attempts'),
      })
    );
  });

  test('returns 400 when no file is provided (before rate limit check)', async () => {
    const repository = {
      deleteUpload: vi.fn(),
      getUploadsByOwner: vi.fn().mockResolvedValue([]),
      findByIdAndOwner: vi.fn().mockResolvedValue(null),
      findByObjectId: vi.fn().mockResolvedValue(null),
      findByKey: vi.fn().mockResolvedValue(null),
      findAllByObjectIdAndOwner: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue([]),
      getLastUploadForUser: vi.fn().mockResolvedValue(null),
      getLastReconvertibleUpload: vi.fn().mockResolvedValue(null),
      findByOwnerAndDedupeKey: vi.fn().mockResolvedValue(null),
      insertNativeDeck: vi.fn(),
      insertConvertedDeck: vi.fn(),
    };
    const notionRepository: INotionRepository = {
      getNotionData: vi.fn() as INotionRepository['getNotionData'],
      saveNotionToken: vi.fn() as INotionRepository['saveNotionToken'],
      getNotionToken: vi.fn() as INotionRepository['getNotionToken'],
      deleteBlocksByOwner: vi.fn() as INotionRepository['deleteBlocksByOwner'],
      deleteNotionData: vi.fn() as INotionRepository['deleteNotionData'],
      markTokenInvalid: vi.fn().mockResolvedValue(undefined),
      clearTokenInvalid: vi.fn().mockResolvedValue(undefined),
      setReconnectEmailSent: vi.fn().mockResolvedValue(true),
    };
    const uploadService = new UploadService(
      repository,
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
    const notionService = new NotionService(notionRepository);

    const blockingLimiter = { check: vi.fn().mockReturnValue(false) };
    const controller = new UploadController(
      uploadService,
      notionService,
      undefined,
      undefined,
      undefined,
      undefined,
      blockingLimiter
    );

    const jsonSpy = vi.fn();
    let capturedStatus = 0;

    const req = {
      file: undefined,
      body: {},
      headers: {},
      socket: { remoteAddress: '10.0.0.1' },
    } as unknown as express.Request;

    const res = {
      locals: {},
      status: (code: number) => {
        capturedStatus = code;
        return { json: jsonSpy } as unknown as express.Response;
      },
    } as unknown as express.Response;

    await controller.retryPdfWithCredential(req, res);

    expect(blockingLimiter.check).not.toHaveBeenCalled();
    expect(capturedStatus).toBe(400);
  });
});

describe('UploadController.getUploads', () => {
  function buildService(rows: Uploads[]): UploadService {
    const repository = {
      getUploadsByOwner: vi.fn().mockResolvedValue(rows),
    } as unknown as IUploadRepository;
    return new UploadService(
      repository,
      {} as JobRepository,
      buildUsersRepo(),
      ...fakeUploadServiceDeps()
    );
  }

  it('maps rows to a typed response carrying the image-drop metadata', async () => {
    const row = {
      id: 7,
      owner: 42,
      key: 'owner-42-deck.apkg',
      filename: 'notes.apkg',
      object_id: null,
      size_mb: 1,
      created_at: new Date('2026-10-06T00:00:00Z'),
      source: null,
      dedupe_key: 'secret-hash',
      dropped_image_count: 3,
      image_drop_reason: 'notion_html_no_folder',
    } as unknown as Uploads;
    const controller = new UploadController(
      buildService([row]),
      {} as unknown as NotionService
    );
    const jsonSpy = vi.fn();
    const res = {
      locals: { owner: 42 },
      json: jsonSpy,
      status: vi.fn(),
    } as unknown as express.Response;

    await controller.getUploads({} as express.Request, res);

    expect(jsonSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 7,
        dropped_image_count: 3,
        image_drop_reason: 'notion_html_no_folder',
        created_at: '2026-10-06T00:00:00.000Z',
      }),
    ]);
    const [payload] = jsonSpy.mock.calls[0] as [Record<string, unknown>[]];
    expect(payload[0]).not.toHaveProperty('dedupe_key');
  });
});
