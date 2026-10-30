import fs from 'node:fs/promises';
import path from 'node:path';

import type { Knex } from 'knex';

export const BOOT_MIGRATIONS_TABLE = 'knex_migrations';
export const BOOT_MIGRATIONS_DIRECTORY = './migrations';

export async function findAppliedMigrationsWithoutFile(
  database: Knex
): Promise<string[]> {
  if (!(await database.schema.hasTable(BOOT_MIGRATIONS_TABLE))) {
    return [];
  }
  const applied: string[] = await database(BOOT_MIGRATIONS_TABLE)
    .orderBy('id')
    .pluck('name');
  const files = new Set(
    await fs.readdir(path.resolve(BOOT_MIGRATIONS_DIRECTORY))
  );
  return applied.filter((name) => !files.has(name));
}
