import type { Knex } from 'knex';
import { JobLockRepository, JOB_LOCK_KEYS } from './JobLockRepository';

function makeDatabase(locked: boolean) {
  const rawCalls: Array<{ sql: string; bindings: unknown[] }> = [];
  const trx = {
    raw: jest.fn(async (sql: string, bindings: unknown[]) => {
      rawCalls.push({ sql, bindings });
      return { rows: [{ locked }] };
    }),
  };
  const database = {
    transaction: jest.fn(async (cb: (t: typeof trx) => Promise<unknown>) =>
      cb(trx)
    ),
  } as unknown as Knex;
  return { database, rawCalls };
}

describe('JobLockRepository', () => {
  it('acquires the advisory lock with the given key and runs the batch', async () => {
    const { database, rawCalls } = makeDatabase(true);
    const repo = new JobLockRepository(database);
    const fn = jest.fn().mockResolvedValue(undefined);

    const ran = await repo.runExclusively(JOB_LOCK_KEYS.reEngagementEmails, fn);

    expect(ran).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(rawCalls).toEqual([
      {
        sql: 'select pg_try_advisory_xact_lock(?) as locked',
        bindings: [JOB_LOCK_KEYS.reEngagementEmails],
      },
    ]);
  });

  it('skips the batch and returns false when the lock is held elsewhere', async () => {
    const { database } = makeDatabase(false);
    const repo = new JobLockRepository(database);
    const fn = jest.fn();

    const ran = await repo.runExclusively(JOB_LOCK_KEYS.inactivityWarnings, fn);

    expect(ran).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('propagates a batch failure so the transaction rolls back', async () => {
    const { database } = makeDatabase(true);
    const repo = new JobLockRepository(database);
    const fn = jest.fn().mockRejectedValue(new Error('batch exploded'));

    await expect(
      repo.runExclusively(JOB_LOCK_KEYS.pauseResumeWarnings, fn)
    ).rejects.toThrow('batch exploded');
  });

  it('allocates a distinct key per job', () => {
    const keys = Object.values(JOB_LOCK_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
