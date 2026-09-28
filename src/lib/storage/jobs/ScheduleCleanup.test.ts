import type { Knex } from 'knex';

jest.mock('./helpers/runFileSystemCleanup', () => ({
  __esModule: true,
  runFileSystemCleanup: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./helpers/deleteOldUploads', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue(undefined),
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
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    errorSpy.mockRestore();
  });

  it('runs the filesystem cleanup on every MS_21 tick', () => {
    ScheduleCleanup(db);

    expect(runFileSystemCleanup).not.toHaveBeenCalled();

    jest.advanceTimersByTime(MS_21);
    expect(runFileSystemCleanup).toHaveBeenCalledTimes(1);
    expect(runFileSystemCleanup).toHaveBeenCalledWith(db);

    jest.advanceTimersByTime(MS_21);
    expect(runFileSystemCleanup).toHaveBeenCalledTimes(2);
  });

  it('runs the old-upload cleanup once a day, inside the cleanup hour', () => {
    jest.setSystemTime(utc(10, 30));
    ScheduleCleanup(db);

    jest.advanceTimersByTime(16 * MS_1_HOUR);
    expect(new Date().getUTCHours()).toBe(OLD_UPLOAD_CLEANUP_HOUR_UTC - 1);
    expect(deleteOldUploads).not.toHaveBeenCalled();

    jest.advanceTimersByTime(MS_1_HOUR);
    expect(new Date().getUTCHours()).toBe(OLD_UPLOAD_CLEANUP_HOUR_UTC);
    expect(deleteOldUploads).toHaveBeenCalledTimes(1);
    expect(deleteOldUploads).toHaveBeenCalledWith(db);

    jest.advanceTimersByTime(23 * MS_1_HOUR);
    expect(deleteOldUploads).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(MS_1_HOUR);
    expect(deleteOldUploads).toHaveBeenCalledTimes(2);
  });

  it('a boot shortly before the cleanup hour still runs it that day', () => {
    jest.setSystemTime(utc(OLD_UPLOAD_CLEANUP_HOUR_UTC - 2, 45));
    ScheduleCleanup(db);

    jest.advanceTimersByTime(2 * MS_1_HOUR);
    expect(deleteOldUploads).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected filesystem cleanup so the interval keeps running', async () => {
    (runFileSystemCleanup as jest.Mock).mockRejectedValueOnce(
      new Error('cleanup boom')
    );

    ScheduleCleanup(db);

    jest.advanceTimersByTime(MS_21);
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(expect.any(Error));
  });
});
