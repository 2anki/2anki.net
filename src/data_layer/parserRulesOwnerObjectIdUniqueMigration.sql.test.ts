import knex, { Knex } from 'knex';

const migration = require('../../migrations/20261117000000_parser_rules_owner_object_id_unique.js');

describe('20261117000000 parser_rules unique per owner and page DDL shape', () => {
  let db: ReturnType<typeof knex>;
  let capturedSql: string[];

  beforeAll(() => {
    db = knex({ client: 'pg' });
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(() => {
    capturedSql = [];
  });

  const recordingKnex = () => ({
    raw: (sql: string) => {
      capturedSql.push(sql.replaceAll(/\s+/g, ' ').trim());
      return Promise.resolve();
    },
    schema: {
      alterTable: (
        table: string,
        builder: (t: Knex.AlterTableBuilder) => void
      ) => {
        for (const statement of db.schema.alterTable(table, builder).toSQL()) {
          capturedSql.push(statement.sql);
        }
        return Promise.resolve();
      },
    },
  });

  it('swaps the page-only unique constraint for one per owner and page', async () => {
    await migration.up(recordingKnex());

    expect(capturedSql).toEqual([
      "SET LOCAL lock_timeout = '5s'",
      'alter table "parser_rules" drop constraint "slicer_rules_object_id_unique"',
      'alter table "parser_rules" add constraint "parser_rules_owner_object_id_unique" unique ("owner", "object_id")',
    ]);
  });

  it('keeps the newest row per page and restores the page-only constraint on rollback', async () => {
    await migration.down(recordingKnex());

    expect(capturedSql).toEqual([
      "SET LOCAL lock_timeout = '5s'",
      'DELETE FROM parser_rules a USING parser_rules b WHERE a.object_id = b.object_id AND a.id < b.id',
      'alter table "parser_rules" drop constraint "parser_rules_owner_object_id_unique"',
      'alter table "parser_rules" add constraint "slicer_rules_object_id_unique" unique ("object_id")',
    ]);
  });
});
