import type { SendPauseResumeWarningsUseCase } from '../../../usecases/ops/SendPauseResumeWarningsUseCase';
import type { IJobLockRepository } from '../../../data_layer/JobLockRepository';
import { JOB_LOCK_KEYS } from '../../../data_layer/JobLockRepository';
import type { EventsSink } from '../../../services/events/EventsSink';
import { makeExclusiveBatchRunner } from '../../scheduling/exclusiveBatch';
import { isOverdue, type LastRunAt } from '../../inactivity/jobs/lastRunAt';

export const PAUSE_RESUME_WARNING_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const schedulePauseResumeWarnings = async (
  useCase: SendPauseResumeWarningsUseCase,
  options: {
    intervalMs?: number;
    eventsSink?: EventsSink;
    lastRunAt?: LastRunAt;
    lock?: IJobLockRepository;
  } = {}
): Promise<NodeJS.Timeout> => {
  const intervalMs = options.intervalMs ?? PAUSE_RESUME_WARNING_INTERVAL_MS;

  const tick = async () => {
    try {
      const result = await useCase.execute();
      console.info(`[pause-resume-warnings] sent ${result.count} warning(s)`);
      if (options.eventsSink != null) {
        options.eventsSink.record({
          name: 'email_batch_sent',
          props: { campaign: 'pause_resume', count: result.count },
        });
      }
    } catch (error) {
      console.error('[pause-resume-warnings] daily job failed:', error);
    }
  };

  const eventsSink = options.eventsSink;
  const runBatch = makeExclusiveBatchRunner(tick, {
    label: 'pause-resume-warnings',
    lockKey: JOB_LOCK_KEYS.pauseResumeWarnings,
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
