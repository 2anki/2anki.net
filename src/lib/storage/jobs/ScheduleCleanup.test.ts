import { vi, type Mock, type MockInstance } from 'vitest';
import type { Knex } from 'knex';

vi.mock('./helpers/runFileSystemCleanup', () => ({
  __esModule: true,
  runFileSystemCleanup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./helpers/deleteOldUploads', () => ({
  __esModule: true,
  default: vi.fn().mockResolvedValue(undefined),
  MS_21: 21 * 60 * 1000,
}));

import {
  MS_1_HOUR,
  OLD_UPLOAD_CLEANUP_HOUR_UTC,
  ScheduleCleanup,
} from './ScheduleCleanup';
import { runFileSystemCleanup } from './helpers/runFileSystemCleanup';
import deleteOldUploads, { MS_21 } from './helpers/deleteOldUploads';

const db = { __id: 'fake-knex' } as unknown as Knex;

function utc(hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 8, 28, hour, minute, 0));
}

describe('ScheduleCleanup', () => {
  let errorSpy: MockInstance;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    errorSpy.mockRestore();
  });

  it('runs the filesystem cleanup on every MS_21 tick', () => {
    ScheduleCleanup(db);

    expect(runFileSystemCleanup).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MS_21);
    expect(runFileSystemCleanup).toHaveBeenCalledTimes(1);
    expect(runFileSystemCleanup).toHaveBeenCalledWith(db);

    vi.advanceTimersByTime(MS_21);
    expect(runFileSystemCleanup).toHaveBeenCalledTimes(2);
  });

  it('runs the old-upload cleanup once a day, inside the cleanup hour', () => {
    vi.setSystemTime(utc(10, 30));
    ScheduleCleanup(db);

    vi.advanceTimersByTime(16 * MS_1_HOUR);
    expect(new Date().getUTCHours()).toBe(OLD_UPLOAD_CLEANUP_HOUR_UTC - 1);
    expect(deleteOldUploads).not.toHaveBeenCalled();

    vi.advanceTimersByTime(MS_1_HOUR);
    expect(new Date().getUTCHours()).toBe(OLD_UPLOAD_CLEANUP_HOUR_UTC);
    expect(deleteOldUploads).toHaveBeenCalledTimes(1);
    expect(deleteOldUploads).toHaveBeenCalledWith(db);

    vi.advanceTimersByTime(23 * MS_1_HOUR);
    expect(deleteOldUploads).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(MS_1_HOUR);
    expect(deleteOldUploads).toHaveBeenCalledTimes(2);
  });

  it('a boot shortly before the cleanup hour still runs it that day', () => {
    vi.setSystemTime(utc(OLD_UPLOAD_CLEANUP_HOUR_UTC - 2, 45));
    ScheduleCleanup(db);

    vi.advanceTimersByTime(2 * MS_1_HOUR);
    expect(deleteOldUploads).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected filesystem cleanup so the interval keeps running', async () => {
    (runFileSystemCleanup as Mock).mockRejectedValueOnce(
      new Error('cleanup boom')
    );

    ScheduleCleanup(db);

    vi.advanceTimersByTime(MS_21);
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
  });
});
