import knex, { Knex } from 'knex';

import {
  CohortMember,
  ReturnRecord,
  ReturnRateMetricsService,
  computeReturnRates,
} from './ReturnRateMetricsService';

const NOW = new Date('2026-07-19T00:00:00.000Z');

const CUTOFF_TIMESTAMP = /'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}'/g;

function normalizeCutoff(sql: string): string {
  return sql.replace(CUTOFF_TIMESTAMP, "'<CUTOFF>'");
}

function daysBefore(anchor: Date, n: number): Date {
  return new Date(anchor.getTime() - n * 24 * 60 * 60 * 1000);
}

function daysAfter(anchor: Date, n: number): Date {
  return new Date(anchor.getTime() + n * 24 * 60 * 60 * 1000);
}

describe('ReturnRateMetricsService — generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const service = new ReturnRateMetricsService(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('builds the cohort over conversion_succeeded keyed by identity and source', () => {
    expect(normalizeCutoff(service.buildCohortQuery(NOW).toString())).toBe(
      "select COALESCE(user_id::text, anonymous_id) as owner, COALESCE(props->>'source', 'unknown') as source_type, " +
        'MAX(created_at) as last_success_at from "events" ' +
        'where "name" = \'conversion_succeeded\' and "created_at" >= \'<CUTOFF>\' ' +
        'and COALESCE(user_id::text, anonymous_id) IS NOT NULL ' +
        "group by COALESCE(user_id::text, anonymous_id), COALESCE(props->>'source', 'unknown')"
    );
  });

  it('builds the returns query as a single scan with a LEAD window, never a correlated subquery', () => {
    expect(normalizeCutoff(service.buildReturnsQuery(NOW).toString())).toBe(
      "select COALESCE(e1.user_id::text, e1.anonymous_id) as owner, COALESCE(e1.props->>'source', 'unknown') as source_type, " +
        '"e1"."created_at" as "anchor_at", ' +
        'LEAD(e1.created_at) OVER (' +
        'PARTITION BY COALESCE(e1.user_id::text, e1.anonymous_id), ' +
        "COALESCE(e1.props->>'source', 'unknown') " +
        'ORDER BY e1.created_at) as first_return_at ' +
        'from "events" as "e1" ' +
        'where "e1"."name" = \'conversion_succeeded\' and "e1"."created_at" >= \'<CUTOFF>\' ' +
        'and COALESCE(e1.user_id::text, e1.anonymous_id) IS NOT NULL'
    );
  });
});

describe('computeReturnRates — return-rate windows', () => {
  const asOf = NOW.toISOString();

  function cohortMember(
    owner: string,
    source_type: string,
    last_success_at: Date
  ): CohortMember {
    return {
      owner,
      source_type,
      last_success_at: last_success_at.toISOString(),
    };
  }

  function returnRecord(
    owner: string,
    source_type: string,
    anchor: Date,
    firstReturn: Date
  ): ReturnRecord {
    return {
      owner,
      source_type,
      anchor_at: anchor.toISOString(),
      first_return_at: firstReturn.toISOString(),
    };
  }

  it('counts an identity that returned within 7 days as retained in all windows', () => {
    const anchor = daysBefore(NOW, 20);
    const result = computeReturnRates(
      [cohortMember('u1', 'notion', anchor)],
      [returnRecord('u1', 'notion', anchor, daysAfter(anchor, 5))],
      asOf
    );

    expect(result.overall['7d']).toBeCloseTo(100, 5);
    expect(result.overall['14d']).toBeCloseTo(100, 5);
    expect(result.overall['30d']).toBeCloseTo(100, 5);
  });

  it('counts an identity that returned after 8 days as NOT in 7d but in 14d', () => {
    const anchor = daysBefore(NOW, 40);
    const result = computeReturnRates(
      [cohortMember('u2', 'upload', anchor)],
      [returnRecord('u2', 'upload', anchor, daysAfter(anchor, 8))],
      asOf
    );

    expect(result.overall['7d']).toBeCloseTo(0, 5);
    expect(result.overall['14d']).toBeCloseTo(100, 5);
    expect(result.overall['30d']).toBeCloseTo(100, 5);
  });

  it('breaks down return rates for every source, not just Notion', () => {
    const anchor = daysBefore(NOW, 15);
    const result = computeReturnRates(
      [
        cohortMember('u4', 'notion', anchor),
        cohortMember('u5', 'upload', anchor),
        cohortMember('u6', 'google_drive', anchor),
      ],
      [returnRecord('u4', 'notion', anchor, daysAfter(anchor, 3))],
      asOf
    );

    const bySource = new Map(
      (result.by_source_type ?? []).map((r) => [r.source_type, r])
    );
    expect(bySource.get('notion')?.cohort_size).toBe(1);
    expect(bySource.get('notion')?.returned_7d).toBe(1);
    expect(bySource.get('upload')?.cohort_size).toBe(1);
    expect(bySource.get('upload')?.returned_7d).toBe(0);
    expect(bySource.get('google_drive')?.cohort_size).toBe(1);
    expect(bySource.get('google_drive')?.returned_7d).toBe(0);
  });

  it('uses the smallest gap between conversions for an identity', () => {
    const anchor = daysBefore(NOW, 50);
    const result = computeReturnRates(
      [cohortMember('u7', 'notion', anchor)],
      [
        returnRecord('u7', 'notion', anchor, daysAfter(anchor, 40)),
        returnRecord('u7', 'notion', anchor, daysAfter(anchor, 4)),
      ],
      asOf
    );

    expect(result.overall['7d']).toBeCloseTo(100, 5);
  });

  it('returns null windows and no source breakdown for an empty cohort', () => {
    const result = computeReturnRates([], [], asOf);

    expect(result.overall['7d']).toBeNull();
    expect(result.overall['14d']).toBeNull();
    expect(result.overall['30d']).toBeNull();
    expect(result.by_source_type).toBeNull();
    expect(result.as_of).toBe(asOf);
  });
});

describe('ReturnRateMetricsService — graceful failure', () => {
  it('returns null windows and surfaces the error when the query throws', async () => {
    const failing = { raw: jest.fn() } as unknown as Knex;
    const service = new ReturnRateMetricsService(failing);

    const result = await service.getMetrics();

    expect(result.by_source_type).toBeNull();
    expect(result.overall['7d']).toBeNull();
    expect(result.overall['14d']).toBeNull();
    expect(result.overall['30d']).toBeNull();
    expect(typeof result.error).toBe('string');
    expect((result.error ?? '').length).toBeGreaterThan(0);
  });
});
