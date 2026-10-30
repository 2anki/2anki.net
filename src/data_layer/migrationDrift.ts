import fs from 'node:fs/promises';
import path from 'node:path';

import type { Knex } from 'knex';

export const BOOT_MIGRATIONS_TABLE = 'knex_migrations';
export const BOOT_MIGRATIONS_DIRECTORY = './migrations';

const KNEX_DEFAULT_LOAD_EXTENSIONS = new Set([
  '.co',
  '.coffee',
  '.eg',
  '.iced',
  '.js',
  '.cjs',
  '.litcoffee',
  '.ls',
  '.ts',
]);

export type MigrationDrift = {
  aheadOfBuild: string[];
  withinBuild: string[];
  pendingInBuild: string[];
};

export async function findMigrationDrift(
  database: Knex
): Promise<MigrationDrift> {
  if (!(await database.schema.hasTable(BOOT_MIGRATIONS_TABLE))) {
    return { aheadOfBuild: [], withinBuild: [], pendingInBuild: [] };
  }
  const applied: string[] = await database(BOOT_MIGRATIONS_TABLE)
    .orderBy('id')
    .pluck('name');
  const entries = await fs.readdir(path.resolve(BOOT_MIGRATIONS_DIRECTORY));
  const migrationFiles = entries
    .filter((entry) => KNEX_DEFAULT_LOAD_EXTENSIONS.has(path.extname(entry)))
    .sort();
  const files = new Set(migrationFiles);
  const appliedNames = new Set(applied);
  const missing = applied.filter((name) => !files.has(name));
  const pendingInBuild = migrationFiles.filter(
    (name) => !appliedNames.has(name)
  );
  if (migrationFiles.length === 0) {
    return { aheadOfBuild: [], withinBuild: missing, pendingInBuild };
  }
  const newestFile = migrationFiles[migrationFiles.length - 1];
  return {
    aheadOfBuild: missing.filter((name) => name > newestFile),
    withinBuild: missing.filter((name) => name <= newestFile),
    pendingInBuild,
  };
}

export function toleratesDrift(drift: MigrationDrift): boolean {
  return (
    drift.withinBuild.length === 0 &&
    drift.pendingInBuild.length === 0 &&
    drift.aheadOfBuild.length > 0
  );
}
