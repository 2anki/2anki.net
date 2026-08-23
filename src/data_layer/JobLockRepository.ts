import type { Knex } from 'knex';

/**
 * Central registry so two jobs can never collide on a key. Advisory lock
 * keys are a global namespace per database; allocate new ones here only.
 */
export const JOB_LOCK_KEYS = {
  reEngagementEmails: 21001,
  inactivityWarnings: 21002,
  pauseResumeWarnings: 21003,
  inactiveUserDeletions: 21004,
} as const;

export interface IJobLockRepository {
  runExclusively(lockKey: number, fn: () => Promise<void>): Promise<boolean>;
}

/**
 * Cross-instance mutual exclusion for background batch jobs. During a
 * blue-green deploy both pm2 colors boot the same schedulers; a
 * transaction-scoped Postgres advisory lock (released automatically at
 * commit/rollback, so a crashed holder can never leak it) makes sure only
 * one color executes a batch. Returns false when the lock is held elsewhere
 * and the batch was skipped.
 */
export class JobLockRepository implements IJobLockRepository {
  constructor(private readonly database: Knex) {}

  async runExclusively(
    lockKey: number,
    fn: () => Promise<void>
  ): Promise<boolean> {
    return this.database.transaction(async (trx) => {
      const result = await trx.raw(
        'select pg_try_advisory_xact_lock(?) as locked',
        [lockKey]
      );
      const locked = result?.rows?.[0]?.locked === true;
      if (!locked) {
        return false;
      }
      await fn();
      return true;
    });
  }
}
