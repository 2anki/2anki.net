import type { SendInactivityWarningsUseCase } from '../../../usecases/ops/SendInactivityWarningsUseCase';
import type { IJobLockRepository } from '../../../data_layer/JobLockRepository';
import { JOB_LOCK_KEYS } from '../../../data_layer/JobLockRepository';
import type { EventsSink } from '../../../services/events/EventsSink';
import { makeExclusiveBatchRunner } from '../../scheduling/exclusiveBatch';
import { isOverdue, type LastRunAt } from './lastRunAt';

export const INACTIVITY_WARNING_DAILY_LIMIT = 100;
export const INACTIVITY_WARNING_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const scheduleInactivityWarnings = async (
  useCase: SendInactivityWarningsUseCase,
  options: {
    intervalMs?: number;
    limit?: number;
    eventsSink?: EventsSink;
    lastRunAt?: LastRunAt;
    lock?: IJobLockRepository;
  } = {}
): Promise<NodeJS.Timeout> => {
  const intervalMs = options.intervalMs ?? INACTIVITY_WARNING_INTERVAL_MS;
  const limit = options.limit ?? INACTIVITY_WARNING_DAILY_LIMIT;

  const tick = async () => {
    try {
      const result = await useCase.execute(false, limit);
      console.info(`[inactivity-warnings] sent ${result.count} warning(s)`);
      if (options.eventsSink != null) {
        options.eventsSink.record({
          name: 'email_batch_sent',
          props: { campaign: 'inactivity', count: result.count },
        });
      }
    } catch (error) {
      console.error('[inactivity-warnings] daily job failed:', error);
    }
  };

  const eventsSink = options.eventsSink;
  const runBatch = makeExclusiveBatchRunner(tick, {
    label: 'inactivity-warnings',
    lockKey: JOB_LOCK_KEYS.inactivityWarnings,
    intervalMs,
    lock: options.lock,
    lastRunAt: options.lastRunAt,
    flush: eventsSink != null ? () => eventsSink.flush() : undefined,
  });

  if (options.lastRunAt != null) {
    const lastRun = await options.lastRunAt();
    if (isOverdue(lastRun, intervalMs, Date.now())) {
      await runBatch();
    }
  }

  const handle = setInterval(runBatch, intervalMs);
  handle.unref();
  return handle;
};
