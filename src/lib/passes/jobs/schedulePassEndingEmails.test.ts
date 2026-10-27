import { vi, type Mocked } from 'vitest';

import type { EventsSink } from '../../../services/events/EventsSink';
import type { SendPassEndingEmailsUseCase } from '../../../usecases/ops/SendPassEndingEmailsUseCase';
import {
  PASS_ENDING_EMAIL_LIMIT,
  schedulePassEndingEmails,
} from './schedulePassEndingEmails';

function makeUseCase(
  result = { count: 2, dryRun: false }
): Mocked<Pick<SendPassEndingEmailsUseCase, 'execute'>> {
  return { execute: vi.fn().mockResolvedValue(result) };
}

describe('schedulePassEndingEmails', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('ticks on startup when the job has never run', async () => {
    const useCase = makeUseCase();
    const lastRunAt = vi.fn().mockResolvedValue(null);

    const handle = await schedulePassEndingEmails(
      useCase as unknown as SendPassEndingEmailsUseCase,
      { intervalMs: 1000, lastRunAt }
    );

    expect(useCase.execute).toHaveBeenCalledTimes(1);
    expect(useCase.execute).toHaveBeenCalledWith(
      false,
      PASS_ENDING_EMAIL_LIMIT
    );
    clearInterval(handle);
  });

  it('does not tick on startup when the last run is within the interval', async () => {
    const useCase = makeUseCase();
    const lastRunAt = vi.fn().mockResolvedValue(new Date(Date.now() - 500));

    const handle = await schedulePassEndingEmails(
      useCase as unknown as SendPassEndingEmailsUseCase,
      { intervalMs: 1000, lastRunAt }
    );

    expect(useCase.execute).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('arms the interval after the startup check so later windows still fire', async () => {
    const useCase = makeUseCase();
    const lastRunAt = vi.fn().mockResolvedValue(new Date(Date.now() - 500));

    const handle = await schedulePassEndingEmails(
      useCase as unknown as SendPassEndingEmailsUseCase,
      { intervalMs: 1000, lastRunAt }
    );

    await vi.advanceTimersByTimeAsync(1000);

    expect(useCase.execute).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });

  it('records the batch under the pass_ending campaign', async () => {
    const useCase = makeUseCase({ count: 3, dryRun: false });
    const eventsSink: Mocked<Pick<EventsSink, 'record' | 'flush'>> = {
      record: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };

    const handle = await schedulePassEndingEmails(
      useCase as unknown as SendPassEndingEmailsUseCase,
      {
        intervalMs: 1000,
        lastRunAt: vi.fn().mockResolvedValue(null),
        eventsSink: eventsSink as unknown as EventsSink,
      }
    );

    expect(eventsSink.record).toHaveBeenCalledWith({
      name: 'email_batch_sent',
      props: { campaign: 'pass_ending', count: 3, server_marker: true },
    });
    clearInterval(handle);
  });

  it('logs and keeps the schedule when a tick throws', async () => {
    const useCase = makeUseCase();
    useCase.execute.mockRejectedValueOnce(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handle = await schedulePassEndingEmails(
      useCase as unknown as SendPassEndingEmailsUseCase,
      { intervalMs: 1000, lastRunAt: vi.fn().mockResolvedValue(null) }
    );

    expect(errorSpy).toHaveBeenCalledWith(
      '[pass-ending] job failed:',
      expect.any(Error)
    );

    await vi.advanceTimersByTimeAsync(1000);

    expect(useCase.execute).toHaveBeenCalledTimes(2);
    clearInterval(handle);
    errorSpy.mockRestore();
  });
});
