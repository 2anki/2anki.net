import fs from 'node:fs/promises';
import path from 'node:path';

import type { Knex } from 'knex';

export const BOOT_MIGRATIONS_TABLE = 'knex_migrations';
export const BOOT_MIGRATIONS_DIRECTORY = './migrations';

const MIGRATION_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts']);

export type MigrationDrift = {
  aheadOfBuild: string[];
  withinBuild: string[];
};

export async function findMigrationDrift(
  database: Knex
): Promise<MigrationDrift> {
  if (!(await database.schema.hasTable(BOOT_MIGRATIONS_TABLE))) {
    return { aheadOfBuild: [], withinBuild: [] };
  }
  const applied: string[] = await database(BOOT_MIGRATIONS_TABLE)
    .orderBy('id')
    .pluck('name');
  const entries = await fs.readdir(path.resolve(BOOT_MIGRATIONS_DIRECTORY));
  const files = new Set(entries);
  const migrationFiles = entries
    .filter((entry) => MIGRATION_EXTENSIONS.has(path.extname(entry)))
    .sort();
  const newestFile: string | undefined =
    migrationFiles[migrationFiles.length - 1];
  const missing = applied.filter((name) => !files.has(name));
  return {
    aheadOfBuild: missing.filter(
      (name) => newestFile === undefined || name > newestFile
    ),
    withinBuild: missing.filter(
      (name) => newestFile !== undefined && name <= newestFile
    ),
  };
}

export function toleratesDrift(drift: MigrationDrift): boolean {
  return drift.withinBuild.length === 0 && drift.aheadOfBuild.length > 0;
}
