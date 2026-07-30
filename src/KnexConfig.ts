import { Knex } from 'knex';

// This fallback used to embed a real username and password (CWE-798) in a
// public repo. The fallback itself stays, so local dev and the data_layer tests
// reach a localhost Postgres without extra setup, but it carries no credentials:
// libpq falls back to the OS user, and anything needing a password sets
// DATABASE_URL. Never put credentials back in here — `secrets:S6698` will catch
// it, and so will KnexConfig.test.ts.
const LOCAL_FALLBACK_DATABASE_URL = 'postgresql://localhost:5432/n';

const KnexConfig: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL || LOCAL_FALLBACK_DATABASE_URL,
  pool: {
    min: 2,
    max: 20,
  },
  migrations: {
    tableName: 'knex_migrations',
    directory: process.env.MIGRATIONS_DIR || 'migrations',
    // Local dev DBs accumulate knex_migrations rows for files that were later
    // renamed on main, which makes migrate.latest() crash the boot with
    // "migration directory is corrupt". Skip that check in local dev only;
    // prod and CI keep strict validation.
    disableMigrationsListValidation: process.env.LOCAL_DEV === 'true',
  },
};

export default KnexConfig;
