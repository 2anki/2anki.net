import type { IReEngagementRepository } from '../../../data_layer/ReEngagementRepository';
import type { IJobLockRepository } from '../../../data_layer/JobLockRepository';
import { JOB_LOCK_KEYS } from '../../../data_layer/JobLockRepository';
import type { IEmailService } from '../../../services/EmailService/EmailService';
import type { EventsSink } from '../../../services/events/EventsSink';
import { sendReEngagementEmails } from '../../storage/jobs/helpers/sendReEngagementEmails';
import { makeExclusiveBatchRunner } from '../../scheduling/exclusiveBatch';
import { isOverdue, type LastRunAt } from '../../inactivity/jobs/lastRunAt';

export const RE_ENGAGEMENT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const scheduleReEngagementEmails = async (
  repo: IReEngagementRepository,
  emailService: IEmailService,
  eventsSink: EventsSink,
  options: {
    intervalMs?: number;
    lastRunAt?: LastRunAt;
    lock?: IJobLockRepository;
  } = {}
): Promise<NodeJS.Timeout> => {
  const intervalMs = options.intervalMs ?? RE_ENGAGEMENT_INTERVAL_MS;

  const tick = async () => {
    try {
      const { count } = await sendReEngagementEmails(repo, emailService);
      console.info(`[re-engagement] sent ${count} email(s)`);
      eventsSink.record({
        name: 'email_batch_sent',
        props: { campaign: 'reengagement', count },
      });
    } catch (error) {
      console.error('[re-engagement] daily job failed:', error);
    }
  };

  const runBatch = makeExclusiveBatchRunner(tick, {
    label: 're-engagement',
    lockKey: JOB_LOCK_KEYS.reEngagementEmails,
    intervalMs,
    lock: options.lock,
    lastRunAt: options.lastRunAt,
    flush: () => eventsSink.flush(),
  });

  // Blue-green redeploys reset the interval before it can elapse, so without a
  // catch-up the tick almost never fires. Eligibility is a fixed 24-hour band,
  // which makes a missed day permanent for everyone in it.
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
