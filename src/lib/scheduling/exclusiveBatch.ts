import type { IJobLockRepository } from '../../data_layer/JobLockRepository';
import { isOverdue, type LastRunAt } from '../inactivity/jobs/lastRunAt';

export interface ExclusiveBatchOptions {
  label: string;
  lockKey: number;
  intervalMs: number;
  lock?: IJobLockRepository;
  lastRunAt?: LastRunAt;
  flush?: () => Promise<void>;
}

/**
 * Wraps a scheduler tick so only one instance runs the batch at a time.
 * Inside the lock the batch re-checks lastRunAt with a half-interval guard:
 * an instance that acquires the lock right after another instance finished
 * (the blue-green boot-overlap race) sees the fresh run and skips instead of
 * duplicating the batch. The guard is half the interval — not the full one —
 * so the holder's own next on-schedule tick, which lands a few seconds shy
 * of the exact interval, still runs. `flush` is awaited before the lock is
 * released so the run's events are durably visible to the next contender's
 * re-check (the events sink buffers writes).
 */
export const makeExclusiveBatchRunner = (
  tick: () => Promise<void>,
  options: ExclusiveBatchOptions
): (() => Promise<void>) => {
  const { label, lockKey, intervalMs, lock, lastRunAt, flush } = options;

  return async () => {
    if (lock == null) {
      await tick();
      return;
    }
    try {
      const ran = await lock.runExclusively(lockKey, async () => {
        if (lastRunAt != null) {
          const lastRun = await lastRunAt();
          if (!isOverdue(lastRun, intervalMs / 2, Date.now())) {
            console.info(
              `[${label}] batch skipped: ran recently on another instance`
            );
            return;
          }
        }
        await tick();
        if (flush != null) {
          await flush();
        }
      });
      if (!ran) {
        console.info(`[${label}] batch skipped: lock held by another instance`);
      }
    } catch (error) {
      console.error(`[${label}] exclusive batch run failed:`, error);
    }
  };
};
