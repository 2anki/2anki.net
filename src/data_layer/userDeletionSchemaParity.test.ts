import fs from 'node:fs';
import path from 'node:path';

/**
 * #3974 found eleven tables holding user rows with no link to `users`. Those
 * rows survived account deletion for as long as the tables existed, and nothing
 * checked for it. This test is the check.
 *
 * A table with a user-identifying column is only safe if one of two things is
 * true: the database cascades the delete for us, or `deleteUser` removes the
 * rows by hand. Kanel types the column as `UsersId` exactly when a foreign key
 * to `users` exists, so the generated types tell us which tables are covered by
 * the database. Everything else has to be in the explicit list, or a user's rows
 * outlive their account.
 *
 * Reads generated source as text rather than importing it, the same shape as
 * `src/lib/sonarConfigParity.test.ts`, so no database connection is needed and
 * the guard runs in CI.
 *
 * What this does NOT cover: the delete *rule*. Kanel types a column as
 * `UsersId` for any foreign key to `users`, whether it cascades or is the
 * default `NO ACTION`. #3974 hit both failure modes — a missing key leaks rows,
 * and a `NO ACTION` key made every user who had answered a re-engagement email
 * undeletable with a 23503. Only the first is checkable from the generated
 * types; confirming `confdeltype` needs a live connection, so a `NO ACTION` key
 * still has to be caught in migration review.
 */

const GENERATED_DIR = path.join(__dirname, 'public');
const USERS_REPOSITORY = path.join(__dirname, 'UsersRepository.ts');

// Columns that identify a user. A new name here is a new way to hold user data,
// so extend this list when one appears rather than letting it go unchecked.
const USER_COLUMNS = [
  'owner',
  'user_id',
  'claimed_by_user_id',
  'resolved_by',
  'updated_by',
];

// Tables keyed on an email address rather than a user id. `deleteUser` clears
// them through emailTables, and they carry no `users` foreign key by design.
const EMAIL_KEYED_TABLES = new Set([
  'feedback',
  'emoji_feedback',
  'abandoned_checkout_recovery_emails',
]);

function toSnakeCase(fileName: string): string {
  return fileName
    .replace(/\.ts$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

interface UnlinkedColumn {
  table: string;
  column: string;
  type: string;
}

function readUnlinkedUserColumns(): UnlinkedColumn[] {
  const found: UnlinkedColumn[] = [];
  const files = fs
    .readdirSync(GENERATED_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));

  for (const file of files) {
    const source = fs.readFileSync(path.join(GENERATED_DIR, file), 'utf8');
    const body = /export default interface \w+ \{(.*?)\n\}/s.exec(source);
    if (!body) continue;

    for (const column of USER_COLUMNS) {
      const declaration = new RegExp(`\\n  ${column}\\??: ([^;]+);`).exec(
        body[1]
      );
      if (!declaration) continue;
      const type = declaration[1].trim();
      // `UsersId` is kanel's branded type for a real foreign key to users.
      if (!type.includes('UsersId')) {
        found.push({ table: toSnakeCase(file), column, type });
      }
    }
  }
  return found;
}

function readExplicitlyDeletedTables(): Set<string> {
  const source = fs.readFileSync(USERS_REPOSITORY, 'utf8');
  const block = /const ownerTables = \[(.*?)\];/s.exec(source);
  if (!block) {
    throw new Error(
      'Could not find the ownerTables list in UsersRepository.deleteUser — if it was renamed, update this test to match.'
    );
  }
  const names = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  return new Set(names);
}

describe('account deletion covers every table holding user rows', () => {
  it('deletes or cascades every user-identifying column', () => {
    const unlinked = readUnlinkedUserColumns();
    const deleted = readExplicitlyDeletedTables();

    const uncovered = unlinked.filter(
      (c) => !deleted.has(c.table) && !EMAIL_KEYED_TABLES.has(c.table)
    );

    expect(uncovered.map((c) => `${c.table}.${c.column} (${c.type})`)).toEqual(
      []
    );
  });

  it('finds the lists it depends on', () => {
    // If a rename silently empties either side, both assertions above pass
    // vacuously. This fails loudly instead.
    expect(readExplicitlyDeletedTables().size).toBeGreaterThan(0);
    expect(readUnlinkedUserColumns().length).toBeGreaterThan(0);
  });
});
