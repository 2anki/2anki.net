import knex from 'knex';

import {
  BusinessMetricsCacheRepository,
  InMemoryBusinessMetricsCacheRepository,
} from './BusinessMetricsCacheRepository';

describe('BusinessMetricsCacheRepository', () => {
  it('loads a single key by primary key instead of scanning the table', () => {
    const database = knex({ client: 'pg' });
    const repository = new BusinessMetricsCacheRepository(database);
    const sql = repository.buildLoadQuery('_today_snapshot').toString();
    expect(sql).toBe(
      'select "metric_key", "value", "cached_at", "expires_at" from "business_metrics_cache" where "metric_key" = \'_today_snapshot\' limit 1'
    );
  });
});

describe('InMemoryBusinessMetricsCacheRepository', () => {
  it('returns one entry by key and null for a missing key', async () => {
    const repository = new InMemoryBusinessMetricsCacheRepository();
    const entry = {
      key: '_today_snapshot' as const,
      value: { rows: [] },
      cachedAt: new Date('2026-09-09T10:00:00.000Z'),
      expiresAt: new Date('2026-09-09T10:05:00.000Z'),
    };
    await repository.upsertMany([entry]);
    await expect(repository.load('_today_snapshot')).resolves.toEqual(entry);
    await expect(repository.load('mrr_usd')).resolves.toBeNull();
  });
});
