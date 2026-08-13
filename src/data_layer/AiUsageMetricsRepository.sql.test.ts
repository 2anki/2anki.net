import knex from 'knex';

import {
  AiUsageMetricsRepository,
  mapAiUsageGroupRows,
  mapAiUsageTotalsRow,
} from './AiUsageMetricsRepository';

const since = new Date('2026-07-14T00:00:00.000Z');

const SUMS =
  'count(*) as calls, ' +
  "coalesce(sum((props->>'cost_usd')::numeric), 0) as cost_usd, " +
  "coalesce(sum((props->'usage'->>'input_tokens')::bigint), 0) as input_tokens, " +
  "coalesce(sum((props->'usage'->>'output_tokens')::bigint), 0) as output_tokens, " +
  "coalesce(sum((props->'usage'->>'cache_creation_input_tokens')::bigint), 0) as cache_creation_tokens, " +
  "coalesce(sum((props->'usage'->>'cache_read_input_tokens')::bigint), 0) as cache_read_tokens";

describe('AiUsageMetricsRepository generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new AiUsageMetricsRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('sums cost and nested usage tokens over the window', () => {
    const { sql, bindings } = repository.buildTotalsQuery(since).toSQL();

    expect(sql).toBe(
      `select ${SUMS} from "events" where "name" = ? and "created_at" >= ?`
    );
    expect(bindings).toEqual(['ai_usage_recorded', since]);
  });

  it('groups by the surface prop ordered by spend', () => {
    const { sql } = repository.buildBySurfaceQuery(since).toSQL();

    expect(sql).toBe(
      `select props->>'surface' as key, ${SUMS} from "events" where "name" = ? and "created_at" >= ? group by props->>'surface' order by cost_usd desc`
    );
  });

  it('groups by the model prop ordered by spend', () => {
    const { sql } = repository.buildByModelQuery(since).toSQL();

    expect(sql).toBe(
      `select props->>'model' as key, ${SUMS} from "events" where "name" = ? and "created_at" >= ? group by props->>'model' order by cost_usd desc`
    );
  });

  it('groups by day in chronological order', () => {
    const { sql } = repository.buildByDayQuery(since).toSQL();

    expect(sql).toBe(
      `select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as key, ${SUMS} from "events" where "name" = ? and "created_at" >= ? group by date_trunc('day', created_at) order by date_trunc('day', created_at)`
    );
  });
});

describe('row mapping', () => {
  it('coerces string aggregates to numbers and defaults missing rows to zero', () => {
    expect(
      mapAiUsageTotalsRow({
        calls: '12',
        cost_usd: '1.2345',
        input_tokens: '100',
        output_tokens: '50',
        cache_creation_tokens: '10',
        cache_read_tokens: '5',
      })
    ).toEqual({
      calls: 12,
      cost_usd: 1.2345,
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_tokens: 10,
      cache_read_tokens: 5,
    });

    expect(mapAiUsageTotalsRow(undefined)).toEqual({
      calls: 0,
      cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
    });
  });

  it('labels null group keys as unknown', () => {
    const groups = mapAiUsageGroupRows([
      {
        key: null,
        calls: '1',
        cost_usd: '0.1',
        input_tokens: '1',
        output_tokens: '1',
        cache_creation_tokens: '0',
        cache_read_tokens: '0',
      },
    ]);
    expect(groups[0].key).toBe('unknown');
  });
});
