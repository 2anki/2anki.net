jest.mock('./storage/jobs/helpers/performConversion', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(undefined),
  conversionLogPrefix: jest.fn(
    (fields: { jobDbId: string | number; requestId?: string }) =>
      `[conversion] job=${fields.jobDbId} request=${fields.requestId ?? 'none'}`
  ),
  trackConversionFailed: jest.fn(),
}));

jest.mock('../data_layer/NotionRespository');
jest.mock('../data_layer/BlocksCacheRepository');
jest.mock('../data_layer/JobRepository');
jest.mock('../usecases/jobs/SetJobFailedUseCase');

import performConversion, {
  trackConversionFailed,
} from './storage/jobs/helpers/performConversion';
import NotionRepository from '../data_layer/NotionRespository';
import BlocksCacheRepository from '../data_layer/BlocksCacheRepository';
import JobRepository from '../data_layer/JobRepository';
import { SetJobFailedUseCase } from '../usecases/jobs/SetJobFailedUseCase';
import { NOTION_TOKEN_EXPIRED_REASON } from '../usecases/jobs/jobFailureReason';
import { runConversionInWorker } from './conversionTasks';
import type { ConversionWorkerRequest } from './conversionRequestTypes';

const baseRequest: ConversionWorkerRequest = {
  id: 'notion-page-id',
  owner: '42',
  isPaying: true,
  type: 'page',
  title: 'Some page',
  jobDbId: 99,
};

const mockSetJobFailedExecute = jest.fn().mockResolvedValue(undefined);

describe('runConversionInWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (NotionRepository as jest.Mock).mockImplementation(() => ({
      getNotionToken: jest.fn().mockResolvedValue('secret-token'),
    }));
    (BlocksCacheRepository as jest.Mock).mockImplementation(() => ({}));
    (JobRepository as unknown as jest.Mock).mockImplementation(() => ({}));
    (SetJobFailedUseCase as jest.Mock).mockImplementation(() => ({
      execute: mockSetJobFailedExecute,
    }));
  });

  it('rehydrates NotionAPIWrapper from owner and invokes performConversion', async () => {
    const fakeKnex = { __id: 'fake-knex' } as unknown as Parameters<
      typeof performConversion
    >[0];

    await runConversionInWorker(baseRequest, () => fakeKnex);

    expect(performConversion).toHaveBeenCalledTimes(1);
    const [db, request] = (performConversion as jest.Mock).mock.calls[0];
    expect(db).toBe(fakeKnex);
    expect(request).toEqual(
      expect.objectContaining({
        id: baseRequest.id,
        owner: baseRequest.owner,
        isPaying: baseRequest.isPaying,
        type: baseRequest.type,
        title: baseRequest.title,
        jobDbId: baseRequest.jobDbId,
      })
    );
    expect(request.api).toBeDefined();
    expect(typeof request.api.getPage).toBe('function');
  });

  it('forwards the originating requestId into performConversion', async () => {
    const fakeKnex = {} as unknown as Parameters<typeof performConversion>[0];

    await runConversionInWorker(
      { ...baseRequest, requestId: 'req-xyz-789' },
      () => fakeKnex
    );

    const [, request] = (performConversion as jest.Mock).mock.calls[0];
    expect(request.requestId).toBe('req-xyz-789');
  });

  it('sets job failed with notion_token_expired when owner has no Notion token', async () => {
    (NotionRepository as jest.Mock).mockImplementation(() => ({
      getNotionToken: jest.fn().mockResolvedValue(null),
    }));
    const fakeKnex = {} as unknown as Parameters<typeof performConversion>[0];

    await runConversionInWorker(baseRequest, () => fakeKnex);

    expect(performConversion).not.toHaveBeenCalled();
    expect(mockSetJobFailedExecute).toHaveBeenCalledWith(
      baseRequest.id,
      baseRequest.owner,
      NOTION_TOKEN_EXPIRED_REASON
    );
  });

  it('logs a stamped line and tracks conversion_failed when the Notion token has expired', async () => {
    (NotionRepository as jest.Mock).mockImplementation(() => ({
      getNotionToken: jest.fn().mockResolvedValue(null),
    }));
    const infoSpy = jest
      .spyOn(console, 'info')
      .mockImplementation(() => undefined);
    const fakeKnex = {} as unknown as Parameters<typeof performConversion>[0];

    await runConversionInWorker(
      { ...baseRequest, requestId: 'req-expired-1' },
      () => fakeKnex
    );

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '[conversion] job=99 request=req-expired-1 notion token expired'
      ),
      { pageId: baseRequest.id }
    );
    expect(trackConversionFailed).toHaveBeenCalledWith(
      baseRequest.owner,
      baseRequest.anonId,
      baseRequest.type,
      null,
      { reason: 'notion_token_expired' }
    );
    infoSpy.mockRestore();
  });

  it('forwards every worker-request field into performConversion via a structural spread', async () => {
    const fakeKnex = {} as unknown as Parameters<typeof performConversion>[0];
    const fullRequest = {
      ...baseRequest,
      frontField: 'Front',
      backField: 'Back',
      anonId: 'anon-1',
      signupOrigin: '/pricing',
      requestId: 'req-spread-1',
    };

    await runConversionInWorker(fullRequest, () => fakeKnex);

    const [, request] = (performConversion as jest.Mock).mock.calls[0];
    expect(request).toEqual(
      expect.objectContaining({
        id: fullRequest.id,
        owner: fullRequest.owner,
        isPaying: fullRequest.isPaying,
        type: fullRequest.type,
        title: fullRequest.title,
        jobDbId: fullRequest.jobDbId,
        frontField: 'Front',
        backField: 'Back',
        anonId: 'anon-1',
        signupOrigin: '/pricing',
        requestId: 'req-spread-1',
      })
    );
  });

  it('surfaces unexpected rejections to the caller (the pool rejects the task)', async () => {
    (performConversion as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const fakeKnex = {} as unknown as Parameters<typeof performConversion>[0];

    await expect(
      runConversionInWorker(baseRequest, () => fakeKnex)
    ).rejects.toThrow('boom');
  });
});
