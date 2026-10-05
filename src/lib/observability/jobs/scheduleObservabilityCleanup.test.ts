import { vi } from 'vitest';
import {
  scheduleObservabilityCleanup,
  OBSERVABILITY_CLEANUP_INTERVAL_MS,
  OBSERVABILITY_RETENTION_DAYS,
} from './scheduleObservabilityCleanup';

describe('scheduleObservabilityCleanup', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  function makeRepo(
    impl?: () => Promise<{ requestLogs: number; outboundCallLogs: number }>
  ) {
    return {
      deleteOlderThan: vi
        .fn<
          (
            days: number
          ) => Promise<{ requestLogs: number; outboundCallLogs: number }>
        >()
        .mockImplementation(
          impl ??
            (() => Promise.resolve({ requestLogs: 0, outboundCallLogs: 0 }))
        ),
    };
  }

  it('calls deleteOlderThan with the retention window after one interval', async () => {
    const repo = makeRepo();
    const handle = scheduleObservabilityCleanup(repo, { intervalMs: 1000 });

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(repo.deleteOlderThan).toHaveBeenCalledTimes(1);
    expect(repo.deleteOlderThan).toHaveBeenCalledWith(
      OBSERVABILITY_RETENTION_DAYS
    );
    clearInterval(handle);
  });

  it('does not fire before the interval elapses', () => {
    const repo = makeRepo();
    const handle = scheduleObservabilityCleanup(repo, { intervalMs: 1000 });

    vi.advanceTimersByTime(999);

    expect(repo.deleteOlderThan).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('logs completion with the deleted row counts', async () => {
    const repo = makeRepo(() =>
      Promise.resolve({ requestLogs: 12, outboundCallLogs: 4 })
    );
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const handle = scheduleObservabilityCleanup(repo, { intervalMs: 1000 });

    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('[observability-cleanup] completed')
    );
    clearInterval(handle);
  });

  it('catches errors from the repo without rethrowing', async () => {
    const repo = makeRepo(() => Promise.reject(new Error('db down')));
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const handle = scheduleObservabilityCleanup(repo, { intervalMs: 1000 });

    vi.advanceTimersByTime(1000);
    await expect(Promise.resolve()).resolves.toBeUndefined();
    await Promise.resolve();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('[observability-cleanup] failed'),
      expect.any(Error)
    );
    clearInterval(handle);
  });

  it('defaults to a daily interval and a 30-day retention window', () => {
    expect(OBSERVABILITY_CLEANUP_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    expect(OBSERVABILITY_RETENTION_DAYS).toBe(30);
  });
});
