import {
  scheduleReEngagementEmails,
  RE_ENGAGEMENT_INTERVAL_MS,
} from './scheduleReEngagementEmails';
import type { IReEngagementRepository } from '../../../data_layer/ReEngagementRepository';
import type { IEmailService } from '../../../services/EmailService/EmailService';
import type { EventsSink } from '../../../services/events/EventsSink';

jest.mock('../../../lib/storage/jobs/helpers/sendReEngagementEmails', () => ({
  sendReEngagementEmails: jest.fn().mockResolvedValue({ count: 0 }),
}));

import { sendReEngagementEmails } from '../../storage/jobs/helpers/sendReEngagementEmails';

const mockRepo = {} as IReEngagementRepository;
const mockEmailService = {} as IEmailService;

function makeSink(): jest.Mocked<Pick<EventsSink, 'record' | 'flush'>> {
  return { record: jest.fn(), flush: jest.fn().mockResolvedValue(undefined) };
}

describe('scheduleReEngagementEmails', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('fires sendReEngagementEmails after one interval', async () => {
    const sink = makeSink();
    const handle = await scheduleReEngagementEmails(
      mockRepo,
      mockEmailService,
      sink as unknown as EventsSink,
      { intervalMs: 1000 }
    );

    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(sendReEngagementEmails).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });

  it('does not fire before the interval elapses', async () => {
    const sink = makeSink();
    const handle = await scheduleReEngagementEmails(
      mockRepo,
      mockEmailService,
      sink as unknown as EventsSink,
      { intervalMs: 1000 }
    );

    jest.advanceTimersByTime(999);

    expect(sendReEngagementEmails).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('emits email_batch_sent with campaign=reengagement and the returned count', async () => {
    (sendReEngagementEmails as jest.Mock).mockResolvedValueOnce({ count: 7 });
    const sink = makeSink();
    const handle = await scheduleReEngagementEmails(
      mockRepo,
      mockEmailService,
      sink as unknown as EventsSink,
      { intervalMs: 1000 }
    );

    jest.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(sink.record).toHaveBeenCalledWith({
      name: 'email_batch_sent',
      props: { campaign: 'reengagement', count: 7 },
    });
    clearInterval(handle);
  });

  it('catches errors thrown by sendReEngagementEmails without rethrowing', async () => {
    (sendReEngagementEmails as jest.Mock).mockRejectedValueOnce(
      new Error('db down')
    );
    const sink = makeSink();
    const handle = await scheduleReEngagementEmails(
      mockRepo,
      mockEmailService,
      sink as unknown as EventsSink,
      { intervalMs: 1000 }
    );

    jest.advanceTimersByTime(1000);
    await expect(Promise.resolve()).resolves.toBeUndefined();

    expect(sink.record).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('uses RE_ENGAGEMENT_INTERVAL_MS as the default interval', () => {
    expect(RE_ENGAGEMENT_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });

  // Blue-green redeploys reset the interval before it can elapse, so without a
  // startup catch-up the tick rarely runs. Eligibility here is a fixed 24-hour
  // band, so a user missed on their day never becomes eligible again.
  it('runs an overdue tick at startup when the last run is older than the interval', async () => {
    const sink = makeSink();
    const lastRunAt = jest.fn().mockResolvedValue(new Date(Date.now() - 2000));

    const handle = await scheduleReEngagementEmails(
      mockRepo,
      mockEmailService,
      sink as unknown as EventsSink,
      { intervalMs: 1000, lastRunAt }
    );

    expect(sendReEngagementEmails).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });

  it('runs an overdue tick at startup when the job has never run', async () => {
    const sink = makeSink();
    const lastRunAt = jest.fn().mockResolvedValue(null);

    const handle = await scheduleReEngagementEmails(
      mockRepo,
      mockEmailService,
      sink as unknown as EventsSink,
      { intervalMs: 1000, lastRunAt }
    );

    expect(sendReEngagementEmails).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });

  it('does not run a catch-up tick when the last run is recent', async () => {
    const sink = makeSink();
    const lastRunAt = jest.fn().mockResolvedValue(new Date(Date.now() - 10));

    const handle = await scheduleReEngagementEmails(
      mockRepo,
      mockEmailService,
      sink as unknown as EventsSink,
      { intervalMs: 1000, lastRunAt }
    );

    expect(sendReEngagementEmails).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('does not run a catch-up tick when no lastRunAt is supplied', async () => {
    const sink = makeSink();

    const handle = await scheduleReEngagementEmails(
      mockRepo,
      mockEmailService,
      sink as unknown as EventsSink,
      { intervalMs: 1000 }
    );

    expect(sendReEngagementEmails).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('skips the catch-up batch when another instance holds the lock', async () => {
    const sink = makeSink();
    const lastRunAt = jest.fn().mockResolvedValue(null);
    const lock = {
      runExclusively: jest.fn().mockResolvedValue(false),
    };

    const handle = await scheduleReEngagementEmails(
      mockRepo,
      mockEmailService,
      sink as unknown as EventsSink,
      { intervalMs: 1000, lastRunAt, lock }
    );

    expect(lock.runExclusively).toHaveBeenCalledTimes(1);
    expect(sendReEngagementEmails).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('skips the batch when the lock re-check sees a run by another instance', async () => {
    const sink = makeSink();
    // Outer check reads overdue; the re-check inside the lock reads a batch
    // another instance finished moments ago — the blue-green boot race.
    const lastRunAt = jest
      .fn()
      .mockResolvedValueOnce(new Date(Date.now() - 2000))
      .mockResolvedValueOnce(new Date(Date.now() - 10));
    const lock = {
      runExclusively: jest.fn(async (_key: number, fn: () => Promise<void>) => {
        await fn();
        return true;
      }),
    };

    const handle = await scheduleReEngagementEmails(
      mockRepo,
      mockEmailService,
      sink as unknown as EventsSink,
      { intervalMs: 1000, lastRunAt, lock }
    );

    expect(sendReEngagementEmails).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('sends and flushes events inside the lock when still overdue', async () => {
    const sink = makeSink();
    const lastRunAt = jest.fn().mockResolvedValue(null);
    const lock = {
      runExclusively: jest.fn(async (_key: number, fn: () => Promise<void>) => {
        await fn();
        return true;
      }),
    };

    const handle = await scheduleReEngagementEmails(
      mockRepo,
      mockEmailService,
      sink as unknown as EventsSink,
      { intervalMs: 1000, lastRunAt, lock }
    );

    expect(sendReEngagementEmails).toHaveBeenCalledTimes(1);
    expect(sink.flush).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });
});
