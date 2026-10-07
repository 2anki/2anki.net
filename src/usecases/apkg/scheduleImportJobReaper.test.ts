import { vi } from 'vitest';
import {
  scheduleImportJobReaper,
  IMPORT_JOB_MAX_AGE_MS,
} from './scheduleImportJobReaper';
import JobRepository from '../../data_layer/JobRepository';

describe('scheduleImportJobReaper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls deleteOldJobs with the correct type and age', async () => {
    const jobRepository = {
      deleteOldJobs: vi.fn().mockResolvedValue(0),
    } as unknown as JobRepository;

    const timer = scheduleImportJobReaper(jobRepository, {
      intervalMs: 1000,
    });

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(jobRepository.deleteOldJobs).toHaveBeenCalledWith(
      'apkg_import',
      IMPORT_JOB_MAX_AGE_MS
    );

    clearInterval(timer);
  });

  it('logs when jobs are cleaned up', async () => {
    const jobRepository = {
      deleteOldJobs: vi.fn().mockResolvedValue(3),
    } as unknown as JobRepository;

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const timer = scheduleImportJobReaper(jobRepository, {
      intervalMs: 1000,
    });

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(infoSpy).toHaveBeenCalledWith(
      '[import-reaper] cleaned up 3 old import jobs'
    );

    infoSpy.mockRestore();
    clearInterval(timer);
  });

  it('does not throw when deleteOldJobs fails', async () => {
    const jobRepository = {
      deleteOldJobs: vi.fn().mockRejectedValue(new Error('db down')),
    } as unknown as JobRepository;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const timer = scheduleImportJobReaper(jobRepository, {
      intervalMs: 1000,
    });

    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(
      '[import-reaper] tick failed',
      expect.any(Error)
    );

    errorSpy.mockRestore();
    clearInterval(timer);
  });
});
