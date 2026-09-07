import knex from 'knex';

import {
  EmailDeliveryMetricsRepository,
  mapEmailDeliveryRows,
} from './EmailDeliveryMetricsRepository';

const since = new Date('2026-08-08T00:00:00.000Z');

describe('EmailDeliveryMetricsRepository generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new EmailDeliveryMetricsRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('groups delivery events by category and event type over the window', () => {
    const { sql, bindings } = repository.buildCountsQuery(since).toSQL();

    expect(sql).toBe(
      `select props->>'category' as category, props->>'event_type' as event_type, count(*) as count from "events" where "name" = ? and "created_at" >= ? group by props->>'category', props->>'event_type' order by props->>'category'`
    );
    expect(bindings).toEqual(['email_delivery_event', since]);
  });
});

describe('row mapping', () => {
  it('coerces counts and defaults null keys', () => {
    expect(
      mapEmailDeliveryRows([
        { category: 'magic-link-login', event_type: 'delivered', count: '12' },
        { category: null, event_type: null, count: 3 },
      ])
    ).toEqual([
      { category: 'magic-link-login', event_type: 'delivered', count: 12 },
      { category: 'uncategorized', event_type: 'unknown', count: 3 },
    ]);
  });
});
