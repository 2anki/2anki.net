import knex from 'knex';

import {
  GoogleAdsConversionsRepository,
  mapClickConversionRow,
} from './GoogleAdsConversionsRepository';

const since = new Date('2026-07-23T00:00:00.000Z');

describe('GoogleAdsConversionsRepository generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new GoogleAdsConversionsRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('reads the click ids, order id, value and currency from the checkout_completed event props', () => {
    const { sql } = repository.buildClickConversionsQuery(since).toSQL();

    expect(sql).toContain('from "events"');
    expect(sql).toContain("props->>'gclid' as gclid");
    expect(sql).toContain("props->>'gbraid' as gbraid");
    expect(sql).toContain("props->>'wbraid' as wbraid");
    expect(sql).toContain("props->>'order_id' as order_id");
    expect(sql).toContain("props->>'value_cents' as value_cents");
    expect(sql).toContain("props->>'currency' as currency");
  });

  it('keeps only checkout_completed events inside the window', () => {
    const { sql, bindings } = repository
      .buildClickConversionsQuery(since)
      .toSQL();

    expect(sql).toContain('"name" = ?');
    expect(sql).toContain('"created_at" >= ?');
    expect(bindings).toContain('checkout_completed');
    expect(bindings).toContain(since);
  });

  it('counts only rows the Stripe webhook marked, never a client-tracked event', () => {
    const { sql, bindings } = repository
      .buildClickConversionsQuery(since)
      .toSQL();

    expect(sql).toContain("props->>'order_source' = ?");
    expect(bindings).toContain('stripe_webhook');
  });

  it('requires at least one click id and a stored order id, value and currency', () => {
    const { sql } = repository.buildClickConversionsQuery(since).toSQL();

    expect(sql).toContain(
      "(props->>'gclid' is not null or props->>'gbraid' is not null or props->>'wbraid' is not null)"
    );
    expect(sql).toContain("props->>'order_id' is not null");
    expect(sql).toContain("props->>'value_cents' is not null");
    expect(sql).toContain("props->>'currency' is not null");
  });

  it('orders rows oldest first so the upload reads chronologically', () => {
    const { sql } = repository.buildClickConversionsQuery(since).toSQL();
    expect(sql).toContain('order by "created_at" asc');
  });
});

describe('mapClickConversionRow', () => {
  const base = {
    gclid: 'Cj0abc',
    gbraid: null,
    wbraid: null,
    order_id: 'cs_test_123',
    value_cents: '600',
    currency: 'usd',
    created_at: new Date('2026-10-21T14:05:09.000Z'),
  };

  it('maps a row into a typed conversion with a numeric value', () => {
    expect(mapClickConversionRow(base)).toEqual({
      gclid: 'Cj0abc',
      gbraid: null,
      wbraid: null,
      orderId: 'cs_test_123',
      valueCents: 600,
      currency: 'usd',
      conversionTime: new Date('2026-10-21T14:05:09.000Z'),
    });
  });

  it('parses a string created_at into a Date', () => {
    const mapped = mapClickConversionRow({
      ...base,
      created_at: '2026-10-21T14:05:09.000Z',
    });
    expect(mapped?.conversionTime).toEqual(
      new Date('2026-10-21T14:05:09.000Z')
    );
  });

  it('returns null when no click id is present', () => {
    expect(
      mapClickConversionRow({
        ...base,
        gclid: null,
        gbraid: null,
        wbraid: null,
      })
    ).toBeNull();
  });

  it('returns null when the order id or currency is missing', () => {
    expect(mapClickConversionRow({ ...base, order_id: null })).toBeNull();
    expect(mapClickConversionRow({ ...base, currency: null })).toBeNull();
  });

  it('returns null when the value is not a number', () => {
    expect(mapClickConversionRow({ ...base, value_cents: 'oops' })).toBeNull();
  });
});
