import knex, { Knex } from 'knex';

const migration = require('../../migrations/20261014000000_drop_public_listing_from_deck_shares.js');

describe('20261014000000 drop public listing from deck_shares DDL shape', () => {
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
    schema: {
      raw: (sql: string) => {
        capturedSql.push(sql);
        return Promise.resolve();
      },
      alterTable: (
        table: string,
        builder: (t: Knex.CreateTableBuilder) => void
      ) => {
        const compiled = db.schema.alterTable(table, builder).toSQL();
        for (const statement of compiled) {
          capturedSql.push(statement.sql);
        }
        return Promise.resolve();
      },
    },
  });

  it('runs inside the default transaction so a partial failure rolls back', () => {
    expect(migration.config).toBeUndefined();
  });

  it('drops the partial listing index before the columns it filters on', async () => {
    await migration.up(recordingKnex());

    const indexDrop = capturedSql.findIndex((sql) =>
      sql.includes('DROP INDEX IF EXISTS deck_shares_public_listing_idx')
    );
    const columnDrop = capturedSql.findIndex((sql) =>
      sql.includes('drop column "is_public"')
    );
    expect(indexDrop).toBe(0);
    expect(columnDrop).toBeGreaterThan(indexDrop);
  });

  it('drops all three unused listing columns', async () => {
    await migration.up(recordingKnex());

    const joined = capturedSql.join('\n');
    expect(joined).toContain('alter table "deck_shares"');
    expect(joined).toContain('drop column "is_public"');
    expect(joined).toContain('drop column "title"');
    expect(joined).toContain('drop column "card_count"');
  });

  it('restores the columns with their original defaults and the index on rollback', async () => {
    await migration.down(recordingKnex());

    const joined = capturedSql.join('\n');
    expect(joined).toContain(
      'add column "is_public" boolean not null default \'0\''
    );
    expect(joined).toContain('add column "title" varchar(120)');
    expect(joined).toContain('add column "card_count" integer');
    expect(capturedSql[capturedSql.length - 1]).toContain(
      'CREATE INDEX IF NOT EXISTS deck_shares_public_listing_idx'
    );
  });
});
