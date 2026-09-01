jest.mock('./storage/jobs/helpers/performConversion', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(undefined),
}));

const mockPoolRun = jest.fn();

jest.mock('../data_layer/NotionRespository');
jest.mock('../data_layer/BlocksCacheRepository');
jest.mock('../data_layer/JobRepository');
jest.mock('../usecases/jobs/SetJobFailedUseCase');

jest.mock('piscina', () => {
  const construct = jest.fn();
  const fakePiscina = jest.fn().mockImplementation((options) => {
    construct(options);
    return {
      run: (...args: unknown[]) => mockPoolRun(...args),
      close: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
      queueSize: 0,
    };
  });
  (fakePiscina as unknown as { construct: jest.Mock }).construct = construct;
  return { __esModule: true, default: fakePiscina };
});

import performConversion from './storage/jobs/helpers/performConversion';
import NotionRepository from '../data_layer/NotionRespository';
import BlocksCacheRepository from '../data_layer/BlocksCacheRepository';
import JobRepository from '../data_layer/JobRepository';
import { SetJobFailedUseCase } from '../usecases/jobs/SetJobFailedUseCase';
import { NOTION_TOKEN_EXPIRED_REASON } from '../usecases/jobs/jobFailureReason';
import Piscina from 'piscina';
import {
  resolveConversionWorkers,
  runConversionInWorker,
  runUploadGeneration,
  shutdownConversionPool,
  initConversionPool,
  resetConversionPoolForTesting,
  shouldRecyclePool,
  runConversion,
  POOL_CLOSE_TIMEOUT_MS,
  MAX_OLD_GENERATION_SIZE_MB,
  ConversionWorkerRequest,
} from './conversionPool';
import { UploadGenerationTask } from '../usecases/uploads/uploadGenerationTypes';

interface FakePoolHandle {
  close: jest.Mock<Promise<void>, []>;
  destroy: jest.Mock<Promise<void>, []>;
  queueSize: number;
}

function fakePoolHandle(
  closeImpl: () => Promise<void>,
  queueSize = 0
): FakePoolHandle {
  return {
    close: jest.fn(closeImpl),
    destroy: jest.fn().mockResolvedValue(undefined),
    queueSize,
  };
}

const baseRequest: ConversionWorkerRequest = {
  id: 'notion-page-id',
  owner: '42',
  isPaying: true,
  type: 'page',
  title: 'Some page',
  jobDbId: 99,
};

describe('resolveConversionWorkers', () => {
  const previous = process.env.CONVERSION_WORKERS;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.CONVERSION_WORKERS;
    } else {
      process.env.CONVERSION_WORKERS = previous;
    }
  });

  it('defaults to 4 when env is unset', () => {
    delete process.env.CONVERSION_WORKERS;
    expect(resolveConversionWorkers()).toBe(4);
  });

  it('respects a valid CONVERSION_WORKERS override', () => {
    process.env.CONVERSION_WORKERS = '2';
    expect(resolveConversionWorkers()).toBe(2);
  });

  it('falls back to 4 when env is non-numeric or below 1', () => {
    process.env.CONVERSION_WORKERS = '0';
    expect(resolveConversionWorkers()).toBe(4);
    process.env.CONVERSION_WORKERS = 'banana';
    expect(resolveConversionWorkers()).toBe(4);
  });
});

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

  it('forwards the originating requestId into performConversion so worker logs join the request', async () => {
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

  it('surfaces unexpected rejections to the caller (controller .catch logs them)', async () => {
    (performConversion as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    const fakeKnex = {} as unknown as Parameters<typeof performConversion>[0];

    await expect(
      runConversionInWorker(baseRequest, () => fakeKnex)
    ).rejects.toThrow('boom');
  });
});

describe('runUploadGeneration', () => {
  beforeEach(() => {
    mockPoolRun.mockReset();
  });

  it('dispatches the task on the shared pool under the uploadGeneration name', async () => {
    mockPoolRun.mockResolvedValueOnce({ ok: true, packages: [], warnings: [] });
    const task = {
      paying: false,
      files: [],
      settings: {},
      workspace: {},
      enqueuedAt: 1,
      userId: null,
    } as unknown as UploadGenerationTask;

    const result = await runUploadGeneration(task);

    expect(mockPoolRun).toHaveBeenCalledWith(task, {
      name: 'uploadGeneration',
      transferList: undefined,
    });
    expect(result).toEqual({ ok: true, packages: [], warnings: [] });
  });

  it('forwards the transfer list so progress ports reach the worker', async () => {
    mockPoolRun.mockResolvedValueOnce({ ok: true, packages: [], warnings: [] });
    const fakePort = { __port: true } as never;
    const task = {
      paying: true,
      files: [],
      settings: {},
      workspace: {},
      enqueuedAt: 1,
      userId: 7,
      progressPort: fakePort,
    } as unknown as UploadGenerationTask;

    await runUploadGeneration(task, [fakePort]);

    expect(mockPoolRun).toHaveBeenCalledWith(task, {
      name: 'uploadGeneration',
      transferList: [fakePort],
    });
  });
});

describe('shutdownConversionPool', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    errorSpy.mockRestore();
  });

  it('lets an in-flight conversion finish inside the budget without force-destroying', async () => {
    let release: (() => void) | null = null;
    const handle = fakePoolHandle(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );

    const shutdown = shutdownConversionPool({
      timeoutMs: 23_000,
      handle: handle as never,
    });

    await jest.advanceTimersByTimeAsync(22_000);
    release!();
    await shutdown;

    expect(handle.destroy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('force-destroys and names the dropped queue when the budget is exceeded', async () => {
    const handle = fakePoolHandle(() => new Promise<void>(() => undefined), 3);

    const shutdown = shutdownConversionPool({
      timeoutMs: 23_000,
      handle: handle as never,
    });

    await jest.advanceTimersByTimeAsync(23_000);
    await shutdown;

    expect(handle.destroy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('3 queued conversion(s)')
    );
  });
});

describe('initConversionPool', () => {
  const construct = (Piscina as unknown as { construct: jest.Mock }).construct;

  beforeEach(() => {
    resetConversionPoolForTesting();
    construct.mockClear();
    (Piscina as unknown as jest.Mock).mockClear();
  });

  afterEach(() => {
    resetConversionPoolForTesting();
  });

  it('sets closeTimeout to the drain budget so close() waits for in-flight conversions', () => {
    initConversionPool();

    expect(construct).toHaveBeenCalledTimes(1);
    expect(construct.mock.calls[0][0]).toMatchObject({
      closeTimeout: POOL_CLOSE_TIMEOUT_MS,
    });
  });

  it('keeps the drain budget well above piscina default so large decks finish', () => {
    expect(POOL_CLOSE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('caps per-worker old-gen heap so V8 reclaims per-conversion buffers', () => {
    initConversionPool();

    expect(construct.mock.calls[0][0]).toMatchObject({
      resourceLimits: { maxOldGenerationSizeMb: MAX_OLD_GENERATION_SIZE_MB },
    });
  });
});

describe('shouldRecyclePool', () => {
  it.each([
    [0, 50, false, false],
    [49, 50, false, false],
    [50, 50, false, true],
    [75, 50, false, true],
    [50, 50, true, false],
  ])(
    'completed=%p threshold=%p recycling=%p => %p',
    (completed, threshold, recycling, expected) => {
      expect(shouldRecyclePool(completed, threshold, recycling)).toBe(expected);
    }
  );
});

describe('conversion pool recycling', () => {
  const construct = (Piscina as unknown as { construct: jest.Mock }).construct;
  const previous = process.env.CONVERSION_WORKER_RECYCLE_TASKS;

  beforeEach(() => {
    jest.useFakeTimers();
    resetConversionPoolForTesting();
    construct.mockClear();
    (Piscina as unknown as jest.Mock).mockClear();
    mockPoolRun.mockReset();
    mockPoolRun.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    resetConversionPoolForTesting();
    if (previous === undefined) {
      delete process.env.CONVERSION_WORKER_RECYCLE_TASKS;
    } else {
      process.env.CONVERSION_WORKER_RECYCLE_TASKS = previous;
    }
  });

  it('recreates the pool after the recycle threshold of completed tasks', async () => {
    process.env.CONVERSION_WORKER_RECYCLE_TASKS = '2';

    await runConversion(baseRequest);
    expect(construct).toHaveBeenCalledTimes(1);

    await runConversion(baseRequest);
    // Second completion hits the threshold: the pool is drained and a fresh one
    // is constructed so worker heaps reset.
    expect(construct).toHaveBeenCalledTimes(2);
  });

  it('does not recycle before the threshold is reached', async () => {
    process.env.CONVERSION_WORKER_RECYCLE_TASKS = '5';

    await runConversion(baseRequest);
    await runConversion(baseRequest);

    expect(construct).toHaveBeenCalledTimes(1);
  });
});
