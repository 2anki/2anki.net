import knex, { Knex } from 'knex';

const migration = require('../../migrations/20261125120000_gift_validity_from_first_use.js');

describe('20261125120000 gift validity from first use', () => {
  let db: ReturnType<typeof knex>;
  let captured: { sql: string; bindings: readonly unknown[] }[];
  let flagUpdates: Record<string, unknown>[];

  beforeAll(() => {
    db = knex({ client: 'pg' });
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    captured = [];
    flagUpdates = [];
  });

  const recordingKnex = () => {
    const recorder = (table: string) => ({
      where: () => ({
        update: (values: Record<string, unknown>) => {
          flagUpdates.push({ table, ...values });
          return Promise.resolve(1);
        },
      }),
    });
    return Object.assign(recorder, {
      raw: (sql: string, bindings: readonly unknown[] = []) => {
        captured.push({ sql: sql.replaceAll(/\s+/g, ' ').trim(), bindings });
        return Promise.resolve();
      },
      schema: {
        alterTable: (
          table: string,
          builder: (t: Knex.CreateTableBuilder) => void
        ) => {
          for (const statement of db.schema
            .alterTable(table, builder)
            .toSQL()) {
            captured.push({ sql: statement.sql, bindings: [] });
          }
          return Promise.resolve();
        },
      },
    });
  };

  it('sets a lock timeout before it touches the table', async () => {
    await migration.up(recordingKnex());

    expect(captured[0].sql).toBe("SET LOCAL lock_timeout = '5s'");
  });

  it('adds a nullable first_used_at, so a grant with no AI call has no clock', async () => {
    await migration.up(recordingKnex());

    expect(captured[1].sql).toBe(
      'alter table "ai_credit_gifts" add column "first_used_at" timestamptz null'
    );
  });

  it("moves each existing grant's clock to its first AI call, and gives an unused grant the gift's end", async () => {
    await migration.up(recordingKnex());

    expect(captured[2].sql).toContain('set first_used_at = s.first_at');
    expect(captured[2].sql).toContain('and g.first_used_at is null');
    expect(captured[2].sql).toContain("where name = 'ai_usage_recorded'");
    expect(captured[3]).toEqual({
      sql: "update ai_credit_gifts set expires_at = case when first_used_at is null then ?::timestamptz else least(first_used_at + interval '7 days', ?::timestamptz) end where expires_at > now()",
      bindings: ['2026-12-04T22:00:00.000Z', '2026-12-04T22:00:00.000Z'],
    });
  });

  it('recomputes only grants still running, so an expired grant stays expired and never counts against the cap again', async () => {
    await migration.up(recordingKnex());

    expect(captured[3].sql.endsWith('where expires_at > now()')).toBe(true);
  });

  it('rolls back to 48 hours from the grant, never past the end, and drops the column', async () => {
    await migration.down(recordingKnex());

    expect(captured.map((c) => c.sql)).toEqual([
      "SET LOCAL lock_timeout = '5s'",
      "update ai_credit_gifts set expires_at = least(claimed_at + interval '48 hours', ?::timestamptz)",
      'alter table "ai_credit_gifts" drop column "first_used_at"',
    ]);
    expect(flagUpdates).toEqual([
      expect.objectContaining({
        table: 'feature_flags',
        description: expect.stringContaining('48 hours'),
      }),
    ]);
  });
});
