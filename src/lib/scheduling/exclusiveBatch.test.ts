import { makeExclusiveBatchRunner } from './exclusiveBatch';
import type { IJobLockRepository } from '../../data_layer/JobLockRepository';

const HOUR = 60 * 60 * 1000;
const INTERVAL = 24 * HOUR;

function grantingLock(): IJobLockRepository & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    async runExclusively(key, fn) {
      calls.push(key);
      await fn();
      return true;
    },
  };
}

function deniedLock(): IJobLockRepository {
  return {
    async runExclusively() {
      return false;
    },
  };
}

describe('makeExclusiveBatchRunner', () => {
  it('runs the tick directly when no lock is configured', async () => {
    const tick = jest.fn().mockResolvedValue(undefined);
    const run = makeExclusiveBatchRunner(tick, {
      label: 'test-job',
      lockKey: 1,
      intervalMs: INTERVAL,
    });

    await run();

    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('runs the tick under the lock with the configured key', async () => {
    const tick = jest.fn().mockResolvedValue(undefined);
    const lock = grantingLock();
    const run = makeExclusiveBatchRunner(tick, {
      label: 'test-job',
      lockKey: 21099,
      intervalMs: INTERVAL,
      lock,
    });

    await run();

    expect(lock.calls).toEqual([21099]);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('skips the tick when the lock is held by another instance', async () => {
    const tick = jest.fn();
    const run = makeExclusiveBatchRunner(tick, {
      label: 'test-job',
      lockKey: 1,
      intervalMs: INTERVAL,
      lock: deniedLock(),
    });

    await run();

    expect(tick).not.toHaveBeenCalled();
  });

  it('skips the tick when another instance ran within the last half interval', async () => {
    const tick = jest.fn();
    const run = makeExclusiveBatchRunner(tick, {
      label: 'test-job',
      lockKey: 1,
      intervalMs: INTERVAL,
      lock: grantingLock(),
      lastRunAt: async () => new Date(Date.now() - 2 * HOUR),
    });

    await run();

    expect(tick).not.toHaveBeenCalled();
  });

  it('runs the tick when the last run is older than half the interval', async () => {
    const tick = jest.fn().mockResolvedValue(undefined);
    const run = makeExclusiveBatchRunner(tick, {
      label: 'test-job',
      lockKey: 1,
      intervalMs: INTERVAL,
      lock: grantingLock(),
      lastRunAt: async () => new Date(Date.now() - 23 * HOUR),
    });

    await run();

    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('flushes recorded events before the lock is released', async () => {
    const order: string[] = [];
    const tick = jest.fn(async () => {
      order.push('tick');
    });
    const flush = jest.fn(async () => {
      order.push('flush');
    });
    const lock: IJobLockRepository = {
      async runExclusively(_key, fn) {
        await fn();
        order.push('release');
        return true;
      },
    };
    const run = makeExclusiveBatchRunner(tick, {
      label: 'test-job',
      lockKey: 1,
      intervalMs: INTERVAL,
      lock,
      flush,
    });

    await run();

    expect(order).toEqual(['tick', 'flush', 'release']);
  });

  it('contains a lock failure instead of crashing the scheduler', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const tick = jest.fn();
    const lock: IJobLockRepository = {
      async runExclusively() {
        throw new Error('db unreachable');
      },
    };
    const run = makeExclusiveBatchRunner(tick, {
      label: 'test-job',
      lockKey: 1,
      intervalMs: INTERVAL,
      lock,
    });

    await expect(run()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
