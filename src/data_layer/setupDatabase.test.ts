import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Knex, { Knex as KnexType } from 'knex';
import { vi } from 'vitest';

import { setupDatabase } from './index';

const CREATE_JOBS = `exports.up = (knex) => knex.schema.createTable('jobs', (t) => {
  t.increments('id');
  t.string('status');
  t.string('type');
});
exports.down = (knex) => knex.schema.dropTable('jobs');
`;

const CREATE_EXTRA = `exports.up = (knex) => knex.schema.createTable('extra', (t) => {
  t.increments('id');
});
exports.down = (knex) => knex.schema.dropTable('extra');
`;

const JOBS_MIGRATION = '20260101000000_create_jobs.js';
const EXTRA_MIGRATION = '20260102000000_create_extra.js';

describe('setupDatabase migration list drift', () => {
  const originalCwd = process.cwd();
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalMigrationsDir = process.env.MIGRATIONS_DIR;
  let root: string;
  let migrationsDir: string;
  let database: KnexType;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-database-'));
    migrationsDir = path.join(root, 'migrations');
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(path.join(migrationsDir, JOBS_MIGRATION), CREATE_JOBS);
    fs.writeFileSync(path.join(migrationsDir, EXTRA_MIGRATION), CREATE_EXTRA);
    process.env.DATABASE_URL = 'postgresql://unused-in-this-test/n';
    process.env.MIGRATIONS_DIR = migrationsDir;
    database = Knex({
      client: 'better-sqlite3',
      connection: { filename: path.join(root, 'db.sqlite') },
      useNullAsDefault: true,
    });
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await database.destroy();
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalMigrationsDir === undefined) {
      delete process.env.MIGRATIONS_DIR;
    } else {
      process.env.MIGRATIONS_DIR = originalMigrationsDir;
    }
  });

  it('boots when the database records a migration this build has no file for, and warns with its name', async () => {
    await setupDatabase(database);
    fs.rmSync(path.join(migrationsDir, EXTRA_MIGRATION));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await setupDatabase(database);

    expect(process.exit).not.toHaveBeenCalled();
    const warnings = warn.mock.calls.map((call) => call.join(' '));
    expect(warnings).toEqual([expect.stringContaining(EXTRA_MIGRATION)]);
    expect(warnings[0]).not.toContain(JOBS_MIGRATION);
  });

  it('keeps strict validation and exits when a missing migration sorts before a file this build has, as a rename does', async () => {
    await setupDatabase(database);
    fs.rmSync(path.join(migrationsDir, JOBS_MIGRATION));
    fs.writeFileSync(
      path.join(migrationsDir, '20260101000001_create_jobs_renamed.js'),
      CREATE_JOBS
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(setupDatabase(database)).rejects.toThrow('process.exit(1)');

    expect(warn).not.toHaveBeenCalled();
    expect(await database.schema.hasTable('jobs')).toBe(true);
    expect(await database('knex_migrations').pluck('name')).toEqual([
      JOBS_MIGRATION,
      EXTRA_MIGRATION,
    ]);
  });

  it('keeps strict validation when one missing migration is newer than the build and another is not', async () => {
    await setupDatabase(database);
    fs.rmSync(path.join(migrationsDir, JOBS_MIGRATION));
    fs.rmSync(path.join(migrationsDir, EXTRA_MIGRATION));
    fs.writeFileSync(
      path.join(migrationsDir, '20260101000001_create_jobs_renamed.js'),
      CREATE_JOBS
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(setupDatabase(database)).rejects.toThrow('process.exit(1)');

    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps strict validation and runs nothing when the newest applied migration was renamed to an earlier name', async () => {
    await setupDatabase(database);
    fs.renameSync(
      path.join(migrationsDir, EXTRA_MIGRATION),
      path.join(migrationsDir, '20260101500000_create_extra_renamed.js')
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(setupDatabase(database)).rejects.toThrow('process.exit(1)');

    expect(warn).not.toHaveBeenCalled();
    expect(await database('knex_migrations').pluck('name')).toEqual([
      JOBS_MIGRATION,
      EXTRA_MIGRATION,
    ]);
  });

  it('keeps strict validation when the build has no migration files at all', async () => {
    await setupDatabase(database);
    fs.rmSync(path.join(migrationsDir, JOBS_MIGRATION));
    fs.rmSync(path.join(migrationsDir, EXTRA_MIGRATION));
    fs.writeFileSync(path.join(migrationsDir, 'README.md'), 'not a migration');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(setupDatabase(database)).rejects.toThrow('process.exit(1)');

    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps strict migration-list validation when every applied migration has a file', async () => {
    await setupDatabase(database);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const latest = vi.spyOn(
      Object.getPrototypeOf(database.migrate) as KnexType.Migrator,
      'latest'
    );

    await setupDatabase(database);

    expect(process.exit).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(
      expect.objectContaining({ disableMigrationsListValidation: false })
    );
  });

  it('applies pending migrations on a fresh database without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await setupDatabase(database);

    const applied = await database('knex_migrations').pluck('name');
    expect(applied).toEqual([JOBS_MIGRATION, EXTRA_MIGRATION]);
    expect(warn).not.toHaveBeenCalled();
  });
});
