import {
  resolveConversionWorkers,
  describeConversionPool,
  shutdownConversionPool,
  resetConversionPoolForTesting,
  runConversion,
  POOL_CLOSE_TIMEOUT_MS,
  MAX_OLD_GENERATION_SIZE_MB,
  type ConversionWorkerRequest,
} from './conversionPool';
import { ConversionProcessPool } from './conversionProcessPool';

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

describe('conversion pool public API', () => {
  afterEach(() => {
    resetConversionPoolForTesting();
  });

  it('describes nothing before the pool is initialised', () => {
    resetConversionPoolForTesting();
    expect(describeConversionPool()).toBeNull();
  });

  it('shutting down an uninitialised pool is a no-op', async () => {
    resetConversionPoolForTesting();
    await expect(shutdownConversionPool()).resolves.toBeUndefined();
  });

  it('keeps the drain budget well above the slowest conversion', () => {
    expect(POOL_CLOSE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('runs Notion conversions in the background lane keyed by owner', async () => {
    vi.spyOn(ConversionProcessPool.prototype, 'start').mockImplementation(
      () => undefined
    );
    const runTask = vi
      .spyOn(ConversionProcessPool.prototype, 'runTask')
      .mockResolvedValue(undefined);
    try {
      await runConversion({ owner: '42' } as ConversionWorkerRequest);
      expect(runTask).toHaveBeenCalledWith(
        { type: 'conversion', request: { owner: '42' } },
        undefined,
        { kind: 'background', owner: '42' }
      );
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('exposes the V8 old-gen cap for the extractor to size under', () => {
    expect(MAX_OLD_GENERATION_SIZE_MB).toBe(1024);
  });
});
