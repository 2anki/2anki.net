import type { IJobLockRepository } from '../../../data_layer/JobLockRepository';
import { JOB_LOCK_KEYS } from '../../../data_layer/JobLockRepository';
import type { RunMetricTripwireUseCase } from '../../../usecases/ops/RunMetricTripwireUseCase';
import { isOverdue, type LastRunAt } from '../../inactivity/jobs/lastRunAt';
import { makeExclusiveBatchRunner } from '../../scheduling/exclusiveBatch';

// Six hours, not twenty-four: a deploy restart or interval drift can never
// skip a whole UTC day, and the per-metric per-day dedup makes the extra
// checks of the same day silent.
export const METRIC_TRIPWIRE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const scheduleMetricTripwire = async (
  useCase: RunMetricTripwireUseCase,
  options: {
    lock?: IJobLockRepository;
    lastRunAt?: LastRunAt;
    log?: (line: string) => void;
  } = {}
): Promise<NodeJS.Timeout> => {
  const log = options.log ?? ((line: string) => console.info(line));

  const tick = async () => {
    try {
      const result = await useCase.execute(new Date());
      log(
        `[metric-tripwire] checked day=${result.day} tripped=${result.tripped.length}`
      );
    } catch (error) {
      console.error('[metric-tripwire] check failed:', error);
    }
  };

  const runBatch = makeExclusiveBatchRunner(tick, {
    label: 'metric-tripwire',
    lockKey: JOB_LOCK_KEYS.metricTripwire,
    intervalMs: METRIC_TRIPWIRE_INTERVAL_MS,
    lock: options.lock,
    lastRunAt: options.lastRunAt,
  });

  if (options.lastRunAt != null) {
    const lastRun = await options.lastRunAt();
    if (isOverdue(lastRun, METRIC_TRIPWIRE_INTERVAL_MS, Date.now())) {
      await runBatch();
    }
  }

  const handle = setInterval(runBatch, METRIC_TRIPWIRE_INTERVAL_MS);
  handle.unref();
  log(
    `[metric-tripwire] scheduled every ${METRIC_TRIPWIRE_INTERVAL_MS / 60_000} min`
  );
  return handle;
};
