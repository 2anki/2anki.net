import knexLib, { Knex } from 'knex';
import {
  EventsRepository,
  EventRow,
  buildConversionFailedByReasonQuery,
  buildDistinctAsksQuery,
} from './EventsRepository';

interface FakeStore {
  rows: Record<string, unknown>[];
  insertCalls: number;
}

function makeFakeKnex() {
  const store: FakeStore = { rows: [], insertCalls: 0 };

  const buildBuilder = (rows: Record<string, unknown>[]) => {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let distinctCol: string | null = null;

    const applyFilters = () => rows.filter((r) => filters.every((f) => f(r)));

    const builder = {
      where(col: string | Record<string, unknown>, val?: unknown) {
        if (typeof col === 'string') {
          if (val === null) {
            filters.push((r) => r[col] === null);
          } else {
            filters.push((r) => r[col] === val);
          }
        } else {
          for (const [k, v] of Object.entries(col)) {
            filters.push((r) => r[k] === v);
          }
        }
        return builder;
      },
      whereNotNull(col: string) {
        filters.push((r) => r[col] != null);
        return builder;
      },
      whereNull(col: string) {
        filters.push((r) => r[col] == null);
        return builder;
      },
      count(expr: string) {
        const alias = expr.split(' as ')[1] ?? 'count';
        return {
          first: () => {
            const filtered = applyFilters();
            const count = distinctCol
              ? new Set(filtered.map((r) => r[distinctCol as string])).size
              : filtered.length;
            return Promise.resolve({ [alias]: count });
          },
        };
      },
      countDistinct(expr: string) {
        const alias = expr.split(' as ')[1] ?? 'count';
        const colName = expr.split(' as ')[0];
        distinctCol = colName;
        return {
          first: () => {
            const filtered = applyFilters();
            const count = new Set(filtered.map((r) => r[colName])).size;
            return Promise.resolve({ [alias]: count });
          },
        };
      },
    };
    return builder;
  };

  const tableHandler = () => ({
    insert: (insertRows: Record<string, unknown>[]) => {
      store.insertCalls += 1;
      for (const row of insertRows) {
        store.rows.push({ ...row, created_at: row.created_at ?? new Date() });
      }
      return Promise.resolve(insertRows.length);
    },
    where: (col: string | Record<string, unknown>, val?: unknown) =>
      buildBuilder(store.rows).where(col, val),
  });

  const fn = (() => tableHandler()) as never;
  return { db: fn, store };
}

function makeFakeKnexReturning(row: Record<string, unknown>): { db: Knex } {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  builder.where = chain;
  builder.select = chain;
  builder.first = () => Promise.resolve(row);
  const db = (() => builder) as unknown as Knex;
  (db as unknown as { raw: (s: string) => string }).raw = (s: string) => s;
  return { db };
}

const baseEvent: EventRow = {
  name: 'conversion_succeeded',
  user_id: 1,
  anonymous_id: null,
  props: { source: 'upload' },
  created_at: new Date('2026-06-01T10:00:00Z'),
};

describe('EventsRepository', () => {
  it('insertEvents does nothing when given an empty array', async () => {
    const { db, store } = makeFakeKnex();
    const repo = new EventsRepository(db);
    await repo.insertEvents([]);
    expect(store.insertCalls).toBe(0);
    expect(store.rows).toHaveLength(0);
  });

  it('insertEvents batches all rows in a single insert', async () => {
    const { db, store } = makeFakeKnex();
    const repo = new EventsRepository(db);
    const rows: EventRow[] = [
      baseEvent,
      { ...baseEvent, name: 'deck_downloaded', user_id: 2 },
    ];
    await repo.insertEvents(rows);
    expect(store.insertCalls).toBe(1);
    expect(store.rows).toHaveLength(2);
  });

  it('insertEvents preserves nullable user_id and anonymous_id', async () => {
    const { db, store } = makeFakeKnex();
    const repo = new EventsRepository(db);
    await repo.insertEvents([
      {
        name: 'upload_error_chat_shown',
        props: {},
        user_id: null,
        anonymous_id: 'anon-uuid-1',
      },
    ]);
    expect(store.rows[0].user_id).toBeNull();
    expect(store.rows[0].anonymous_id).toBe('anon-uuid-1');
  });

  it('countByNameForUser returns 0 when both userId and anonymousId are null', async () => {
    const { db } = makeFakeKnex();
    const repo = new EventsRepository(db);
    const since = new Date('2026-01-01');
    const result = await repo.countByNameForUser(
      'upload_error_chat_engaged',
      since,
      null,
      null
    );
    expect(result).toBe(0);
  });
});

function captureGeneratedSql(): { db: Knex; getSql: () => string } {
  const pg = knexLib({ client: 'pg' });
  let sql = '';
  const db = ((table: string) => {
    const qb = pg(table);
    (qb as unknown as { then: unknown }).then = (
      onFulfilled?: (value: unknown) => unknown
    ) => {
      sql = qb.toString();
      return Promise.resolve([]).then(onFulfilled);
    };
    return qb;
  }) as unknown as Knex;
  (db as unknown as { raw: Knex['raw'] }).raw = pg.raw.bind(pg);
  return { db, getSql: () => sql };
}

describe('EventsRepository SQL generation', () => {
  it('aliases the distinct-user count outside the aggregate, not inside count()', async () => {
    const { db, getSql } = captureGeneratedSql();
    const repo = new EventsRepository(db);

    await repo.groupPaywallShownByVariantAndSurface(new Date('2026-05-01'));

    const sql = getSql();
    expect(sql).toContain(
      'count(distinct COALESCE(user_id::text, anonymous_id)) as distinct_users'
    );
    // Regression guard: the broken form put the alias inside count(...), which
    // Postgres rejects with "syntax error at or near \"as\"".
    expect(sql).not.toContain('anonymous_id) as distinct_users)');
  });

  it('generates a valid grouped click count', async () => {
    const { db, getSql } = captureGeneratedSql();
    const repo = new EventsRepository(db);

    await repo.groupPaywallClicksByVariant(new Date('2026-05-01'));

    const sql = getSql();
    expect(sql).toContain('count("id") as "click_count"');
    expect(sql).toContain("group by props->>'variant'");
  });

  it('groupUploadFunnel counts distinct identities by stage with PG-only jsonb reads', async () => {
    const { db, getSql } = captureGeneratedSql();
    const repo = new EventsRepository(db);

    await repo.groupUploadFunnel(new Date('2026-05-01'));

    const sql = getSql();
    expect(sql).toContain('name as stage');
    expect(sql).toContain(
      'count(distinct COALESCE(user_id::text, anonymous_id)) as distinct_identities'
    );
    expect(sql).toContain('group by "name"');
    expect(sql).not.toContain('anonymous_id) as distinct_identities)');
  });

  it('groupUploadFunnel includes the paid funnel tail stages', async () => {
    const { db, getSql } = captureGeneratedSql();
    const repo = new EventsRepository(db);

    await repo.groupUploadFunnel(new Date('2026-05-01'));

    const sql = getSql();
    expect(sql).toContain("'paywall_shown'");
    expect(sql).toContain("'checkout_completed'");
  });

  it('groupUploadFunnel includes the account_created signup stage', async () => {
    const { db, getSql } = captureGeneratedSql();
    const repo = new EventsRepository(db);

    await repo.groupUploadFunnel(new Date('2026-05-01'));

    const sql = getSql();
    expect(sql).toContain("'account_created'");
  });

  it('groupUploadFunnelByOrigin groups by the signup_origin jsonb prop and stage', async () => {
    const { db, getSql } = captureGeneratedSql();
    const repo = new EventsRepository(db);

    await repo.groupUploadFunnelByOrigin(new Date('2026-05-01'));

    const sql = getSql();
    expect(sql).toContain("props->>'signup_origin' as origin");
    expect(sql).toContain('name as stage');
    expect(sql).toContain(
      'count(distinct COALESCE(user_id::text, anonymous_id)) as distinct_identities'
    );
    expect(sql).toContain("group by props->>'signup_origin', name");
    expect(sql).not.toContain('anonymous_id) as distinct_identities)');
  });

  it('counts asks once per deck, falling back to the person', () => {
    const sql = buildDistinctAsksQuery(
      knexLib({ client: 'pg' }),
      'happy_score_ask_shown',
      new Date('2026-05-01')
    ).toString();

    expect(sql).toContain(
      "count(distinct coalesce('j' || (props->>'job_id'), 'u' || (props->>'upload_id'), 'p' || user_id::text, 'a' || anonymous_id, 'e' || id::text)) as \"count\""
    );
    expect(sql).toContain('"name" = \'happy_score_ask_shown\'');
  });

  it('groupConversionFailedByReason buckets reasons with valid PG LIKE classification', () => {
    const pg = knexLib({ client: 'pg' });
    const sql = buildConversionFailedByReasonQuery(
      pg,
      new Date('2026-05-01')
    ).toString();

    expect(sql).toContain('"name" = \'conversion_failed\'');
    expect(sql).toContain(
      "count(distinct case when (props->>'reason' LIKE 'monthly_limit' OR props->>'reason' LIKE 'anonymous_cap' OR props->>'reason' LIKE '%\"code\":\"monthly_limit\"%') then COALESCE(user_id::text, anonymous_id) end) as paywall"
    );
    expect(sql).toContain(
      "count(distinct case when (props->>'reason' LIKE 'empty_deck' OR props->>'reason' LIKE 'no_decks_created' OR props->>'reason' LIKE 'No cards in this deck yet.%') then COALESCE(user_id::text, anonymous_id) end) as empty"
    );
    expect(sql).toContain(
      "count(distinct case when (props->>'reason' IS NULL OR (NOT (props->>'reason' LIKE 'monthly_limit' OR props->>'reason' LIKE 'anonymous_cap' OR props->>'reason' LIKE '%\"code\":\"monthly_limit\"%') AND NOT (props->>'reason' LIKE 'empty_deck' OR props->>'reason' LIKE 'no_decks_created' OR props->>'reason' LIKE 'No cards in this deck yet.%'))) then COALESCE(user_id::text, anonymous_id) end) as technical"
    );
  });

  it('groupConversionFailedByReason resolves counts through the repository', async () => {
    const { db } = makeFakeKnexReturning({
      paywall: '25',
      empty: '12',
      technical: '5',
    });
    const repo = new EventsRepository(db);

    const result = await repo.groupConversionFailedByReason(
      new Date('2026-05-01')
    );

    expect(result).toEqual({ paywall: 25, empty: 12, technical: 5 });
  });

  it('lastEventAt selects the max created_at filtered by name', async () => {
    const { db, getSql } = captureGeneratedSql();
    const repo = new EventsRepository(db);

    await repo.lastEventAt('inactive_users_deleted');

    const sql = getSql();
    expect(sql).toContain('max("created_at") as "last_at"');
    expect(sql).toContain('"name" = \'inactive_users_deleted\'');
    expect(sql).not.toContain('campaign');
  });

  it('lastEventAt filters on the campaign jsonb prop when given', async () => {
    const { db, getSql } = captureGeneratedSql();
    const repo = new EventsRepository(db);

    await repo.lastEventAt('email_batch_sent', 'inactivity');

    const sql = getSql();
    expect(sql).toContain('max("created_at") as "last_at"');
    expect(sql).toContain("props->>'campaign' = 'inactivity'");
  });
});
