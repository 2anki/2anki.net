import {
  scheduleInactivityWarnings,
  INACTIVITY_WARNING_DAILY_LIMIT,
  INACTIVITY_WARNING_INTERVAL_MS,
} from './scheduleInactivityWarnings';
import type { SendInactivityWarningsUseCase } from '../../../usecases/ops/SendInactivityWarningsUseCase';
import {
  __resetFeatureFlagModuleForTests,
  __setFeatureFlagDependencies,
} from '../../featureFlags/getFeatureFlag';

function makeUseCase(
  result = { count: 3, dryRun: false }
): jest.Mocked<Pick<SendInactivityWarningsUseCase, 'execute'>> {
  return { execute: jest.fn().mockResolvedValue(result) };
}

const flagRepositoryStub = (value: boolean | null) => ({
  getAll: async () => [],
  get: async () => value,
  set: async () => null,
});

describe('scheduleInactivityWarnings', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // The tick consults the outbound_campaign_emails flag before sending; the
    // scheduling behavior under test assumes campaigns are on.
    __setFeatureFlagDependencies({ repository: flagRepositoryStub(true) });
  });
  afterEach(() => {
    __resetFeatureFlagModuleForTests();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('does not send when the outbound_campaign_emails flag is off', async () => {
    __setFeatureFlagDependencies({ repository: flagRepositoryStub(false) });
    const useCase = makeUseCase();
    const lastRunAt = jest.fn().mockResolvedValue(null);

    const handle = await scheduleInactivityWarnings(
      useCase as unknown as SendInactivityWarningsUseCase,
      { intervalMs: 1000, lastRunAt }
    );

    expect(useCase.execute).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('does not send when the flag row is missing (default off)', async () => {
    __setFeatureFlagDependencies({ repository: flagRepositoryStub(null) });
    const useCase = makeUseCase();
    const lastRunAt = jest.fn().mockResolvedValue(null);

    const handle = await scheduleInactivityWarnings(
      useCase as unknown as SendInactivityWarningsUseCase,
      { intervalMs: 1000, lastRunAt }
    );

    expect(useCase.execute).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('ticks on startup when the job has never run', async () => {
    const useCase = makeUseCase();
    const lastRunAt = jest.fn().mockResolvedValue(null);

    const handle = await scheduleInactivityWarnings(
      useCase as unknown as SendInactivityWarningsUseCase,
      { intervalMs: 1000, lastRunAt }
    );

    expect(useCase.execute).toHaveBeenCalledTimes(1);
    expect(useCase.execute).toHaveBeenCalledWith(
      false,
      INACTIVITY_WARNING_DAILY_LIMIT
    );
    clearInterval(handle);
  });

  it('ticks on startup when the last run is older than the interval', async () => {
    const useCase = makeUseCase();
    const lastRunAt = jest.fn().mockResolvedValue(new Date(Date.now() - 2000));

    const handle = await scheduleInactivityWarnings(
      useCase as unknown as SendInactivityWarningsUseCase,
      { intervalMs: 1000, lastRunAt }
    );

    expect(useCase.execute).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });

  it('does not tick on startup when the last run is within the interval', async () => {
    const useCase = makeUseCase();
    const lastRunAt = jest.fn().mockResolvedValue(new Date(Date.now() - 500));

    const handle = await scheduleInactivityWarnings(
      useCase as unknown as SendInactivityWarningsUseCase,
      { intervalMs: 1000, lastRunAt }
    );

    expect(useCase.execute).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('arms the interval after the startup check so later windows still fire', async () => {
    const useCase = makeUseCase();
    const lastRunAt = jest.fn().mockResolvedValue(new Date(Date.now() - 500));

    const handle = await scheduleInactivityWarnings(
      useCase as unknown as SendInactivityWarningsUseCase,
      { intervalMs: 1000, lastRunAt }
    );

    expect(useCase.execute).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1000);

    expect(useCase.execute).toHaveBeenCalledTimes(1);
    expect(useCase.execute).toHaveBeenCalledWith(
      false,
      INACTIVITY_WARNING_DAILY_LIMIT
    );
    clearInterval(handle);
  });

  it('respects a custom limit passed via options', async () => {
    const useCase = makeUseCase();
    const lastRunAt = jest.fn().mockResolvedValue(null);

    const handle = await scheduleInactivityWarnings(
      useCase as unknown as SendInactivityWarningsUseCase,
      { intervalMs: 1000, limit: 50, lastRunAt }
    );

    expect(useCase.execute).toHaveBeenCalledWith(false, 50);
    clearInterval(handle);
  });

  it('defaults to the 24h interval', () => {
    expect(INACTIVITY_WARNING_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
