import { vi } from 'vitest';

import type { IJobLockRepository } from '../../../data_layer/JobLockRepository';
import { JOB_LOCK_KEYS } from '../../../data_layer/JobLockRepository';
import type { RunMetricTripwireUseCase } from '../../../usecases/ops/RunMetricTripwireUseCase';
import {
  METRIC_TRIPWIRE_INTERVAL_MS,
  scheduleMetricTripwire,
} from './scheduleMetricTripwire';

function makeUseCase() {
  const execute = vi.fn().mockResolvedValue({ day: '2026-03-10', tripped: [] });
  return {
    useCase: { execute } as unknown as RunMetricTripwireUseCase,
    execute,
  };
}

class InMemoryLock implements IJobLockRepository {
  held = false;
  readonly keys: number[] = [];

  async runExclusively(
    lockKey: number,
    fn: () => Promise<void>
  ): Promise<boolean> {
    this.keys.push(lockKey);
    if (this.held) return false;
    this.held = true;
    try {
      await fn();
    } finally {
      this.held = false;
    }
    return true;
  }
}

describe('scheduleMetricTripwire', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-11T06:30:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs on boot when the tripwire has never checked', async () => {
    const { useCase, execute } = makeUseCase();

    const handle = await scheduleMetricTripwire(useCase, {
      lastRunAt: vi.fn().mockResolvedValue(null),
      log: () => {},
    });

    expect(execute).toHaveBeenCalledWith(new Date('2026-03-11T06:30:00.000Z'));
    clearInterval(handle);
  });

  it('skips the boot run when another instance checked recently', async () => {
    const { useCase, execute } = makeUseCase();

    const handle = await scheduleMetricTripwire(useCase, {
      lastRunAt: vi
        .fn()
        .mockResolvedValue(new Date('2026-03-11T05:30:00.000Z')),
      log: () => {},
    });

    expect(execute).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('lets only one of two booting colors run the check', async () => {
    const { useCase, execute } = makeUseCase();
    const lock = new InMemoryLock();
    let lastChecked: Date | null = null;
    execute.mockImplementation(async () => {
      lastChecked = new Date();
      return { day: '2026-03-10', tripped: [] };
    });
    const lastRunAt = async () => lastChecked;

    const [blue, green] = await Promise.all([
      scheduleMetricTripwire(useCase, { lock, lastRunAt, log: () => {} }),
      scheduleMetricTripwire(useCase, { lock, lastRunAt, log: () => {} }),
    ]);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(lock.keys).toEqual([
      JOB_LOCK_KEYS.metricTripwire,
      JOB_LOCK_KEYS.metricTripwire,
    ]);
    clearInterval(blue);
    clearInterval(green);
  });

  it('checks again on the interval', async () => {
    const { useCase, execute } = makeUseCase();

    const handle = await scheduleMetricTripwire(useCase, {
      lastRunAt: vi
        .fn()
        .mockResolvedValue(new Date('2026-03-11T05:30:00.000Z')),
      log: () => {},
    });
    await vi.advanceTimersByTimeAsync(METRIC_TRIPWIRE_INTERVAL_MS);

    expect(execute).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });

  it('logs that it is scheduled so a deploy can confirm one schedule per color', async () => {
    const { useCase } = makeUseCase();
    const log = vi.fn();

    const handle = await scheduleMetricTripwire(useCase, {
      lastRunAt: vi
        .fn()
        .mockResolvedValue(new Date('2026-03-11T05:30:00.000Z')),
      log,
    });

    expect(log).toHaveBeenCalledWith(
      '[metric-tripwire] scheduled every 360 min'
    );
    clearInterval(handle);
  });
});
