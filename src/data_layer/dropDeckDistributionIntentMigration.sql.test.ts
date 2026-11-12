import knex, { Knex } from 'knex';

const migration = require('../../migrations/20261115000000_drop_deck_distribution_intent.js');

describe('20261115000000 drop deck_distribution_intent DDL shape', () => {
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

  const capture = (compiled: { sql: string }[]) => {
    for (const statement of compiled) {
      capturedSql.push(statement.sql);
    }
    return Promise.resolve();
  };

  const recordingKnex = () => ({
    fn: db.fn,
    schema: {
      dropTableIfExists: (table: string) =>
        capture(db.schema.dropTableIfExists(table).toSQL()),
      createTable: (
        table: string,
        builder: (t: Knex.CreateTableBuilder) => void
      ) => capture(db.schema.createTable(table, builder).toSQL()),
    },
  });

  it('drops the table only if it still exists', async () => {
    await migration.up(recordingKnex());

    expect(capturedSql).toEqual([
      'drop table if exists "deck_distribution_intent"',
    ]);
  });

  it('recreates the original columns on rollback', async () => {
    await migration.down(recordingKnex());

    expect(capturedSql[0]).toBe(
      'create table "deck_distribution_intent" ("id" serial primary key, "answer" text not null, "notify_email" text null, "user_id" integer not null, "upload_key" text not null, "created_at" timestamptz not null default CURRENT_TIMESTAMP)'
    );
  });

  it('restores the cascading user foreign key and both indexes on rollback', async () => {
    await migration.down(recordingKnex());

    expect(capturedSql.slice(1)).toEqual([
      'alter table "deck_distribution_intent" add constraint "deck_distribution_intent_user_id_foreign" foreign key ("user_id") references "users" ("id") on delete CASCADE',
      'create index "deck_distribution_intent_answer_index" on "deck_distribution_intent" ("answer")',
      'create index "deck_distribution_intent_user_id_index" on "deck_distribution_intent" ("user_id")',
    ]);
  });
});
