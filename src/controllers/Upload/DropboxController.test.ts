import { vi } from 'vitest';
import express from 'express';

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

import { INotionRepository } from '../../data_layer/NotionRespository';
import { IUploadRepository } from '../../data_layer/UploadRespository';
import NotionTokens from '../../data_layer/public/NotionTokens';
import Uploads from '../../data_layer/public/Uploads';
import NotionService from '../../services/NotionService';
import UploadService from '../../services/UploadService';
import JobRepository from '../../data_layer/JobRepository';
import UsersRepository from '../../data_layer/UsersRepository';
import UploadController from './UploadController';
import { GetDropboxUploadsUseCase } from '../../usecases/uploads/GetDropboxUploadsUseCase';
import { DeleteDropboxUploadUseCase } from '../../usecases/uploads/DeleteDropboxUploadUseCase';
import { fakeUploadServiceDeps } from '../../test/fakes/uploadServiceDeps';

function makeController(
  getUseCase: GetDropboxUploadsUseCase,
  deleteUseCase: DeleteDropboxUploadUseCase
) {
  const uploadRepository: IUploadRepository = {
    deleteUpload: vi.fn().mockResolvedValue(1),
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
    getNotionData: vi
      .fn()
      .mockResolvedValue({ owner: 1, token: '...' } as NotionTokens),
    saveNotionToken: vi.fn().mockResolvedValue(true),
    getNotionToken: vi.fn().mockResolvedValue('...'),
    deleteBlocksByOwner: vi.fn().mockResolvedValue(1),
    deleteNotionData: vi.fn().mockResolvedValue(true),
    markTokenInvalid: vi.fn().mockResolvedValue(undefined),
    clearTokenInvalid: vi.fn().mockResolvedValue(undefined),
    setReconnectEmailSent: vi.fn().mockResolvedValue(true),
  };
  const uploadService = new UploadService(
    uploadRepository,
    {} as JobRepository,
    {
      getCardUsage: vi
        .fn()
        .mockResolvedValue({ cards_used: 0, month_started_at: new Date() }),
      incrementCardUsage: vi.fn().mockResolvedValue(1),
    } as unknown as UsersRepository,
    ...fakeUploadServiceDeps()
  );
  const notionService = new NotionService(notionRepository);
  return new UploadController(
    uploadService,
    notionService,
    getUseCase,
    deleteUseCase
  );
}

function makeRes(owner: number | null = 42) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return {
    res: { locals: { owner }, status, json } as unknown as express.Response,
    json,
    status,
  };
}

describe('UploadController.getDropboxUploads', () => {
  it('returns 401 when owner is missing', async () => {
    const getUseCase = {
      execute: vi.fn().mockResolvedValue([]),
    } as unknown as GetDropboxUploadsUseCase;
    const deleteUseCase = {
      execute: vi.fn(),
    } as unknown as DeleteDropboxUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, status, json } = makeRes(null);

    await controller.getDropboxUploads({} as express.Request, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
    expect(getUseCase.execute).not.toHaveBeenCalled();
  });

  it('returns uploads when owner is present', async () => {
    const rows = [{ id: 1, bytes: 1024, name: 'file.pdf', created_at: null }];
    const getUseCase = {
      execute: vi.fn().mockResolvedValue(rows),
    } as unknown as GetDropboxUploadsUseCase;
    const deleteUseCase = {
      execute: vi.fn(),
    } as unknown as DeleteDropboxUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, json } = makeRes(42);

    await controller.getDropboxUploads({ query: {} } as express.Request, res);

    expect(json).toHaveBeenCalledWith(rows);
  });

  it('passes parsed offset to use case', async () => {
    const getUseCase = {
      execute: vi.fn().mockResolvedValue([]),
    } as unknown as GetDropboxUploadsUseCase;
    const deleteUseCase = {
      execute: vi.fn(),
    } as unknown as DeleteDropboxUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res } = makeRes(42);

    await controller.getDropboxUploads(
      { query: { offset: '20' } } as unknown as express.Request,
      res
    );

    expect(getUseCase.execute).toHaveBeenCalledWith(42, 10, 20);
  });
});

describe('UploadController.deleteDropboxUpload', () => {
  it('returns 401 when owner is missing', async () => {
    const getUseCase = {
      execute: vi.fn(),
    } as unknown as GetDropboxUploadsUseCase;
    const deleteUseCase = {
      execute: vi.fn(),
    } as unknown as DeleteDropboxUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, status, json } = makeRes(null);

    await controller.deleteDropboxUpload(
      { params: { id: '5' } } as unknown as express.Request,
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
      execute: vi.fn(),
    } as unknown as GetDropboxUploadsUseCase;
    const deleteUseCase = {
      execute: vi.fn(),
    } as unknown as DeleteDropboxUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, status, json } = makeRes(42);

    await controller.deleteDropboxUpload(
      { params: {} } as unknown as express.Request,
      res
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });

  it('returns 404 when use case throws', async () => {
    const getUseCase = {
      execute: vi.fn(),
    } as unknown as GetDropboxUploadsUseCase;
    const deleteUseCase = {
      execute: vi.fn().mockRejectedValue(new Error('Not found')),
    } as unknown as DeleteDropboxUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, status, json } = makeRes(42);

    await controller.deleteDropboxUpload(
      { params: { id: '99' } } as unknown as express.Request,
      res
    );

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.any(String) })
    );
  });

  it('returns 200 on successful delete', async () => {
    const getUseCase = {
      execute: vi.fn(),
    } as unknown as GetDropboxUploadsUseCase;
    const deleteUseCase = {
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeleteDropboxUploadUseCase;
    const controller = makeController(getUseCase, deleteUseCase);
    const { res, json } = makeRes(42);

    await controller.deleteDropboxUpload(
      { params: { id: '5' } } as unknown as express.Request,
      res
    );

    expect(json).toHaveBeenCalledWith({});
    expect(deleteUseCase.execute).toHaveBeenCalledWith(5, 42);
  });
});
