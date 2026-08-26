import express from 'express';

jest.mock('../../lib/integrations/stripe', () => ({
  getStripe: jest.fn().mockReturnValue({
    customers: { retrieve: jest.fn() },
  }),
  updateStoreSubscription: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/SubscriptionService', () => ({
  __esModule: true,
  default: { findActiveStripeSubscriptions: jest.fn().mockResolvedValue([]) },
}));

import { INotionRepository } from '../../data_layer/NotionRespository';
import { IUploadRepository } from '../../data_layer/UploadRespository';
import NotionTokens from '../../data_layer/public/NotionTokens';
import NotionService from '../../services/NotionService';
import UploadService from '../../services/UploadService';
import JobRepository from '../../data_layer/JobRepository';
import UsersRepository from '../../data_layer/UsersRepository';
import UploadController from './UploadController';
import { GetGoogleDriveUploadsUseCase } from '../../usecases/uploads/GetGoogleDriveUploadsUseCase';
import { DeleteGoogleDriveUploadUseCase } from '../../usecases/uploads/DeleteGoogleDriveUploadUseCase';
import { fakeUploadServiceDeps } from '../../test/fakes/uploadServiceDeps';

function makeController(
  getUseCase: GetGoogleDriveUploadsUseCase,
  deleteUseCase: DeleteGoogleDriveUploadUseCase
) {
  const uploadRepository: IUploadRepository = {
    deleteUpload: jest.fn().mockResolvedValue(1),
    getUploadsByOwner: jest.fn().mockResolvedValue([]),
    findByIdAndOwner: jest.fn().mockResolvedValue(null),
    findByObjectId: jest.fn().mockResolvedValue(null),
    findByKey: jest.fn().mockResolvedValue(null),
    findAllByObjectIdAndOwner: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue([]),
    getLastUploadForUser: jest.fn().mockResolvedValue(null),
    getLastReconvertibleUpload: jest.fn().mockResolvedValue(null),
    findByOwnerAndDedupeKey: jest.fn().mockResolvedValue(null),
    insertNativeDeck: jest.fn(),
    insertConvertedDeck: jest.fn(),
  };
  const notionRepository: INotionRepository = {
    getNotionData: jest
      .fn()
      .mockResolvedValue({ owner: 1, token: '...' } as NotionTokens),
    saveNotionToken: jest.fn().mockResolvedValue(true),
    getNotionToken: jest.fn().mockResolvedValue('...'),
    deleteBlocksByOwner: jest.fn().mockResolvedValue(1),
    deleteNotionData: jest.fn().mockResolvedValue(true),
    markTokenInvalid: jest.fn().mockResolvedValue(undefined),
    clearTokenInvalid: jest.fn().mockResolvedValue(undefined),
    setReconnectEmailSent: jest.fn().mockResolvedValue(true),
  };
  const uploadService = new UploadService(
    uploadRepository,
    {} as JobRepository,
    {
      getCardUsage: jest
        .fn()
        .mockResolvedValue({ cards_used: 0, month_started_at: new Date() }),
      incrementCardUsage: jest.fn().mockResolvedValue(1),
    } as unknown as UsersRepository,
    ...fakeUploadServiceDeps()
  );
  const notionService = new NotionService(notionRepository);
  return new UploadController(
    uploadService,
    notionService,
    undefined,
    undefined,
    getUseCase,
    deleteUseCase
  );
}

function makeRes(owner: number | null = 42) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return {
    res: { locals: { owner }, status, json } as unknown as express.Response,
    json,
    status,
  };
}

describe('UploadController.getGoogleDriveUploads', () => {
  it('returns 401 when owner is missing', async () => {
    const getUseCase = {
      execute: jest.fn().mockResolvedValue([]),
    } as unknown as GetGoogleDriveUploadsUseCase;
    const deleteUseCase = {
      execute: jest.fn(),
    } as unknown as DeleteGoogleDriveUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, status, json } = makeRes(null);

    await controller.getGoogleDriveUploads(
      { query: {} } as express.Request,
      res
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
    expect(getUseCase.execute).not.toHaveBeenCalled();
  });

  it('returns uploads when owner is present', async () => {
    const rows = [
      {
        id: 'abc',
        iconUrl: 'https://drive-thirdparty.googleusercontent.com/16/type/pdf',
        mimeType: 'application/pdf',
        name: 'file.pdf',
        sizeBytes: '1024',
        url: 'https://drive.google.com/file/d/abc/view',
        last_converted_at: null,
      },
    ];
    const getUseCase = {
      execute: jest.fn().mockResolvedValue(rows),
    } as unknown as GetGoogleDriveUploadsUseCase;
    const deleteUseCase = {
      execute: jest.fn(),
    } as unknown as DeleteGoogleDriveUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, json } = makeRes(42);

    await controller.getGoogleDriveUploads(
      { query: {} } as express.Request,
      res
    );

    expect(json).toHaveBeenCalledWith(rows);
  });

  it('passes parsed offset to use case', async () => {
    const getUseCase = {
      execute: jest.fn().mockResolvedValue([]),
    } as unknown as GetGoogleDriveUploadsUseCase;
    const deleteUseCase = {
      execute: jest.fn(),
    } as unknown as DeleteGoogleDriveUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res } = makeRes(42);

    await controller.getGoogleDriveUploads(
      { query: { offset: '20' } } as unknown as express.Request,
      res
    );

    expect(getUseCase.execute).toHaveBeenCalledWith(42, 10, 20);
  });
});

describe('UploadController.deleteGoogleDriveUpload', () => {
  it('returns 401 when owner is missing', async () => {
    const getUseCase = {
      execute: jest.fn(),
    } as unknown as GetGoogleDriveUploadsUseCase;
    const deleteUseCase = {
      execute: jest.fn(),
    } as unknown as DeleteGoogleDriveUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, status, json } = makeRes(null);

    await controller.deleteGoogleDriveUpload(
      { params: { id: 'abc' } } as unknown as express.Request,
      res
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
    expect(deleteUseCase.execute).not.toHaveBeenCalled();
  });

  it('returns 400 when id param is missing', async () => {
    const getUseCase = {
      execute: jest.fn(),
    } as unknown as GetGoogleDriveUploadsUseCase;
    const deleteUseCase = {
      execute: jest.fn(),
    } as unknown as DeleteGoogleDriveUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, status, json } = makeRes(42);

    await controller.deleteGoogleDriveUpload(
      { params: {} } as unknown as express.Request,
      res
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });

  it('returns 400 when id contains characters outside the allowed alphabet', async () => {
    const getUseCase = {
      execute: jest.fn(),
    } as unknown as GetGoogleDriveUploadsUseCase;
    const deleteUseCase = {
      execute: jest.fn(),
    } as unknown as DeleteGoogleDriveUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, status, json } = makeRes(42);

    await controller.deleteGoogleDriveUpload(
      { params: { id: "abc'; DROP TABLE x;--" } } as unknown as express.Request,
      res
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
    expect(deleteUseCase.execute).not.toHaveBeenCalled();
  });

  it('returns 404 when use case throws', async () => {
    const getUseCase = {
      execute: jest.fn(),
    } as unknown as GetGoogleDriveUploadsUseCase;
    const deleteUseCase = {
      execute: jest.fn().mockRejectedValue(new Error('Not found')),
    } as unknown as DeleteGoogleDriveUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, status, json } = makeRes(42);

    await controller.deleteGoogleDriveUpload(
      { params: { id: 'xyz' } } as unknown as express.Request,
      res
    );

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });

  it('returns 200 on successful delete and passes the string id', async () => {
    const getUseCase = {
      execute: jest.fn(),
    } as unknown as GetGoogleDriveUploadsUseCase;
    const deleteUseCase = {
      execute: jest.fn().mockResolvedValue(undefined),
    } as unknown as DeleteGoogleDriveUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, json } = makeRes(42);

    await controller.deleteGoogleDriveUpload(
      { params: { id: 'abc-123_XYZ' } } as unknown as express.Request,
      res
    );

    expect(json).toHaveBeenCalledWith({});
    expect(deleteUseCase.execute).toHaveBeenCalledWith('abc-123_XYZ', 42);
  });
});
