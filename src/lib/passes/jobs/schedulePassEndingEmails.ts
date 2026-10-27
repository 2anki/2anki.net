import type { IJobLockRepository } from '../../../data_layer/JobLockRepository';
import { JOB_LOCK_KEYS } from '../../../data_layer/JobLockRepository';
import type { EventsSink } from '../../../services/events/EventsSink';
import type { SendPassEndingEmailsUseCase } from '../../../usecases/ops/SendPassEndingEmailsUseCase';
import { isOverdue, type LastRunAt } from '../../inactivity/jobs/lastRunAt';
import { withServerMarker } from '../../events/serverEventProps';
import { makeExclusiveBatchRunner } from '../../scheduling/exclusiveBatch';

export const PASS_ENDING_EMAIL_LIMIT = 200;
// Six hours against a 24-hour window: every pass is seen at least three
// times before it ends, and the first sighting is 18 to 24 hours out.
export const PASS_ENDING_EMAIL_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const schedulePassEndingEmails = async (
  useCase: SendPassEndingEmailsUseCase,
  options: {
    intervalMs?: number;
    limit?: number;
    eventsSink?: EventsSink;
    lastRunAt?: LastRunAt;
    lock?: IJobLockRepository;
  } = {}
): Promise<NodeJS.Timeout> => {
  const intervalMs = options.intervalMs ?? PASS_ENDING_EMAIL_INTERVAL_MS;
  const limit = options.limit ?? PASS_ENDING_EMAIL_LIMIT;

  const tick = async () => {
    try {
      const result = await useCase.execute(false, limit);
      console.info(`[pass-ending] sent ${result.count} email(s)`);
      if (options.eventsSink != null) {
        options.eventsSink.record({
          name: 'email_batch_sent',
          props: withServerMarker({
            campaign: 'pass_ending',
            count: result.count,
          }),
        });
      }
    } catch (error) {
      console.error('[pass-ending] job failed:', error);
    }
  };

  const eventsSink = options.eventsSink;
  const runBatch = makeExclusiveBatchRunner(tick, {
    label: 'pass-ending',
    lockKey: JOB_LOCK_KEYS.passEndingEmails,
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
