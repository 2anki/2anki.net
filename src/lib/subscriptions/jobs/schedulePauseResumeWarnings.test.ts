import { vi, type Mocked } from 'vitest';
import { schedulePauseResumeWarnings } from './schedulePauseResumeWarnings';
import type { SendPauseResumeWarningsUseCase } from '../../../usecases/ops/SendPauseResumeWarningsUseCase';
import type { EventsSink } from '../../../services/events/EventsSink';

function makeUseCase(
  result = { count: 2 }
): Mocked<Pick<SendPauseResumeWarningsUseCase, 'execute'>> {
  return { execute: vi.fn().mockResolvedValue(result) };
}

describe('schedulePauseResumeWarnings', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('ticks on startup when the job has never run', async () => {
    const useCase = makeUseCase();
    const lastRunAt = vi.fn().mockResolvedValue(null);

    const handle = await schedulePauseResumeWarnings(
      useCase as unknown as SendPauseResumeWarningsUseCase,
      { intervalMs: 1000, lastRunAt }
    );

    expect(useCase.execute).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });

  it('skips the startup tick when the last run is fresh', async () => {
    const useCase = makeUseCase();
    const lastRunAt = vi.fn().mockResolvedValue(new Date());

    const handle = await schedulePauseResumeWarnings(
      useCase as unknown as SendPauseResumeWarningsUseCase,
      { intervalMs: 1000, lastRunAt }
    );

    expect(useCase.execute).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('records an email_batch_sent event with the pause_resume campaign', async () => {
    const useCase = makeUseCase({ count: 5 });
    const record = vi.fn();
    const lastRunAt = vi.fn().mockResolvedValue(null);

    const handle = await schedulePauseResumeWarnings(
      useCase as unknown as SendPauseResumeWarningsUseCase,
      {
        intervalMs: 1000,
        lastRunAt,
        eventsSink: { record } as unknown as EventsSink,
      }
    );

    expect(record).toHaveBeenCalledWith({
      name: 'email_batch_sent',
      props: { campaign: 'pause_resume', count: 5 },
    });
    clearInterval(handle);
  });

  it('keeps ticking on the interval', async () => {
    const useCase = makeUseCase();

    const handle = await schedulePauseResumeWarnings(
      useCase as unknown as SendPauseResumeWarningsUseCase,
      { intervalMs: 1000 }
    );

    await vi.advanceTimersByTimeAsync(2000);
    expect(useCase.execute).toHaveBeenCalledTimes(2);
    clearInterval(handle);
  });
});
