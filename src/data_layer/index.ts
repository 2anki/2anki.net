import process from 'process';
import path from 'path';

import knex, { Knex } from 'knex';
import MigratorConfig = Knex.MigratorConfig;

import JobRepository from './JobRepository';
import KnexConfig from '../KnexConfig';

// Optional pool sizing. Unset leaves knex defaults (min 2 / max 10) for the main
// process; the conversion child processes set DATABASE_POOL_MIN=0 / MAX=3 in
// their env so an idle child holds no connections and a converting one takes at
// most three, keeping the blue-green peak within the Postgres connection budget.
function resolvePoolConfig(): { min?: number; max?: number } | undefined {
  const min = Number.parseInt(process.env.DATABASE_POOL_MIN ?? '', 10);
  const max = Number.parseInt(process.env.DATABASE_POOL_MAX ?? '', 10);
  const pool: { min?: number; max?: number } = {};
  if (Number.isFinite(min) && min >= 0) pool.min = min;
  if (Number.isFinite(max) && max >= 1) pool.max = max;
  return Object.keys(pool).length > 0 ? pool : undefined;
}

const poolConfig = resolvePoolConfig();

/**
 * Performing this assignment here to prevent new connections from being created.
 */
const SINGLE_CONNECTION = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  ...(poolConfig ? { pool: poolConfig } : {}),
});

export const getDatabase = () => SINGLE_CONNECTION;

export const setupDatabase = async (database: Knex) => {
  if (!process.env.DATABASE_URL) {
    console.info('DATABASE_URL is not set, skipping DB setup.');
    console.warn(
      "Things might not work as expected. If you're running this locally, you can ignore this warning if you are only interested in HTML uploads."
    );
    return;
  }

  try {
    await database.raw('SELECT 1');
    if (process.env.MIGRATIONS_DIR) {
      process.chdir(path.join(process.env.MIGRATIONS_DIR, '..'));
    }

    if (process.env.NODE_ENV === 'production' && !process.env.LOCAL_DEV) {
      console.info('DB is ready');
    }

    await database.migrate.latest(KnexConfig as MigratorConfig);

    // Completed jobs become uploads. Any left during startup means they failed.
    // Claude AND Notion job types are excluded — their markInterrupted* methods
    // in server.ts own those rows so they surface as restartable 'interrupted',
    // not 'failed' with no reason (#4176).
    await new JobRepository(database).failStrandedLegacyJobs();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};
