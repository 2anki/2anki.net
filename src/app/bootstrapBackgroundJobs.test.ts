import fs from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';

import { bootstrapBackgroundJobs } from './bootstrapBackgroundJobs';
import { scheduleAnkifyReaper } from '../lib/ankify/jobs/scheduleAnkifyReaper';
import { scheduleImportJobReaper } from '../usecases/apkg/scheduleImportJobReaper';
import { scheduleAnkifyPolling } from '../lib/ankify/jobs/scheduleAnkifyPolling';
import { AnkifyExportScheduler } from '../services/ankify/AnkifyExportScheduler';

jest.mock('../lib/ankify/jobs/scheduleAnkifyReaper', () => ({
  scheduleAnkifyReaper: jest.fn(),
}));
jest.mock('../usecases/apkg/scheduleImportJobReaper', () => ({
  scheduleImportJobReaper: jest.fn(),
}));
jest.mock('../lib/ankify/jobs/scheduleAnkifyPolling', () => ({
  scheduleAnkifyPolling: jest.fn(),
}));
jest.mock('../services/ankify/AnkifyExportScheduler', () => ({
  AnkifyExportScheduler: jest.fn().mockImplementation(() => ({
    recoverAll: jest.fn().mockResolvedValue(0),
  })),
}));

const fakeDatabase = {} as unknown as Knex;

describe('bootstrapBackgroundJobs', () => {
  const originalInstanceId = process.env.INSTANCE_ID;

  afterEach(() => {
    if (originalInstanceId == null) {
      delete process.env.INSTANCE_ID;
    } else {
      process.env.INSTANCE_ID = originalInstanceId;
    }
    jest.clearAllMocks();
  });

  it('schedules the reapers and the polling worker on the main instance', async () => {
    delete process.env.INSTANCE_ID;

    await bootstrapBackgroundJobs(fakeDatabase);

    expect(scheduleAnkifyReaper).toHaveBeenCalledTimes(1);
    expect(scheduleImportJobReaper).toHaveBeenCalledTimes(1);
    expect(scheduleAnkifyPolling).toHaveBeenCalledTimes(1);
    expect(AnkifyExportScheduler).toHaveBeenCalledTimes(1);
  });

  it('schedules nothing on the singapore instance', async () => {
    process.env.INSTANCE_ID = 'singapore';

    await bootstrapBackgroundJobs(fakeDatabase);

    expect(scheduleAnkifyReaper).not.toHaveBeenCalled();
    expect(scheduleImportJobReaper).not.toHaveBeenCalled();
    expect(scheduleAnkifyPolling).not.toHaveBeenCalled();
    expect(AnkifyExportScheduler).not.toHaveBeenCalled();
  });
});

describe('cleanup scheduling stays single-sourced', () => {
  it('the data layer no longer schedules jobs or imports upward', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../data_layer/index.ts'),
      'utf8'
    );
    expect(source).not.toContain('ScheduleCleanup');
    expect(source).not.toContain('scheduleAnkify');
    expect(source).not.toContain('scheduleImportJobReaper');
    expect(source).not.toContain("from '../usecases");
  });

  it('server.ts schedules ScheduleCleanup exactly once, behind the singapore guard', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../server.ts'),
      'utf8'
    );
    const calls = source.match(/ScheduleCleanup\(/g) ?? [];
    expect(calls).toHaveLength(1);
    const guardIndex = source.indexOf("INSTANCE_ID === 'singapore'");
    const callIndex = source.indexOf('ScheduleCleanup(database)');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(callIndex).toBeGreaterThan(guardIndex);
  });
});
