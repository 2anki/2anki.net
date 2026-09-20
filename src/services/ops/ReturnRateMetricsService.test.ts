import knex, { Knex } from 'knex';

import {
  NewIdentity,
  ReturnRateMetricsService,
  computeReturnRates,
} from './ReturnRateMetricsService';

const NOW = new Date('2026-07-19T00:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function daysBefore(anchor: Date, n: number): Date {
  return new Date(anchor.getTime() - n * DAY_MS);
}

function hoursAfter(anchor: Date, n: number): Date {
  return new Date(anchor.getTime() + n * HOUR_MS);
}

function daysAfter(anchor: Date, n: number): Date {
  return new Date(anchor.getTime() + n * DAY_MS);
}

describe('ReturnRateMetricsService — generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const service = new ReturnRateMetricsService(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('reads first conversions and the first return in a single scan of events', () => {
    const { sql } = service.buildNewIdentitiesQuery(NOW).toSQL();

    expect(sql.match(/from events/gi)).toHaveLength(1);
    expect(sql).toContain('PARTITION BY owner');
    expect(sql).toContain('FIRST_VALUE(source_type)');
    expect(sql).toContain(
      "MIN(created_at) FILTER (WHERE created_at >= first_at + INTERVAL '24 hours') AS first_return_at"
    );
    expect(sql).toContain('GROUP BY owner, first_source, first_at');
    expect(sql).toContain('HAVING first_at >= ?');
  });

  it('never uses a correlated subquery or a LEAD window', () => {
    const { sql } = service.buildNewIdentitiesQuery(NOW).toSQL();

    expect(sql).not.toMatch(/LEAD\(/i);
    expect(sql).not.toMatch(/EXISTS/i);
  });

  it('binds the unknown source, the event name, a 120-day scan cutoff and a 90-day cohort cutoff, in placeholder order', () => {
    const { sql, bindings } = service.buildNewIdentitiesQuery(NOW).toSQL();

    expect(bindings).toEqual([
      'unknown',
      'conversion_succeeded',
      daysBefore(NOW, 120),
      daysBefore(NOW, 90),
    ]);
    expect(sql.match(/\?/g)).toHaveLength(bindings.length);
  });

  it('keeps identities that only have an anonymous id and drops rows with neither id', () => {
    const { sql } = service.buildNewIdentitiesQuery(NOW).toSQL();

    expect(sql).toContain('COALESCE(user_id::text, anonymous_id) IS NOT NULL');
  });
});

describe('computeReturnRates — mature cohorts and a real return', () => {
  const asOf = NOW.toISOString();

  function identity(
    owner: string,
    source_type: string,
    firstAt: Date,
    firstReturnAt: Date | null
  ): NewIdentity {
    return {
      owner,
      source_type,
      first_at: firstAt.toISOString(),
      first_return_at:
        firstReturnAt == null ? null : firstReturnAt.toISOString(),
    };
  }

  it('counts a conversion three days after the first as a return in every window', () => {
    const first = daysBefore(NOW, 40);

    const result = computeReturnRates(
      [identity('u1', 'notion', first, daysAfter(first, 3))],
      asOf
    );

    expect(result.overall).toEqual({ '7d': 100, '14d': 100, '30d': 100 });
  });

  it('counts a conversion eight days after the first in 14d and 30d but not 7d', () => {
    const first = daysBefore(NOW, 40);

    const result = computeReturnRates(
      [identity('u2', 'upload', first, daysAfter(first, 8))],
      asOf
    );

    expect(result.overall).toEqual({ '7d': 0, '14d': 100, '30d': 100 });
  });

  it('counts the exact window boundary as inside the window', () => {
    const first = daysBefore(NOW, 40);

    const result = computeReturnRates(
      [identity('u3', 'upload', first, daysAfter(first, 7))],
      asOf
    );

    expect(result.overall['7d']).toBe(100);
  });

  it('drops an identity from a window it is too new to have finished', () => {
    const tenDaysOld = daysBefore(NOW, 10);

    const result = computeReturnRates(
      [identity('u4', 'notion', tenDaysOld, null)],
      asOf
    );

    expect(result.overall).toEqual({ '7d': 0, '14d': null, '30d': null });
    expect(result.eligible).toEqual({ '7d': 1, '14d': 0, '30d': 0 });
  });

  it('does not let a recent identity that already returned inflate a window it is too new for', () => {
    const tenDaysOld = daysBefore(NOW, 10);

    const result = computeReturnRates(
      [identity('u5', 'notion', tenDaysOld, daysAfter(tenDaysOld, 2))],
      asOf
    );

    expect(result.overall['14d']).toBeNull();
    expect(result.overall['7d']).toBe(100);
  });

  it('keeps the denominators separate per window', () => {
    const result = computeReturnRates(
      [
        identity('old', 'notion', daysBefore(NOW, 60), null),
        identity('mid', 'notion', daysBefore(NOW, 20), null),
        identity('new', 'notion', daysBefore(NOW, 9), null),
      ],
      asOf
    );

    expect(result.eligible).toEqual({ '7d': 3, '14d': 2, '30d': 1 });
  });

  it('treats a repeat within a day of the first as no return', () => {
    const first = daysBefore(NOW, 40);
    const sameSessionRepeat = hoursAfter(first, 0.2);

    const result = computeReturnRates(
      [identity('u6', 'notion', first, sameSessionRepeat)],
      asOf
    );

    expect(result.overall).toEqual({ '7d': 0, '14d': 0, '30d': 0 });
  });

  it('breaks down rates and cohorts by the source of the first conversion', () => {
    const first = daysBefore(NOW, 40);

    const result = computeReturnRates(
      [
        identity('u7', 'notion', first, daysAfter(first, 3)),
        identity('u8', 'upload', first, null),
        identity('u9', 'google_drive', first, null),
      ],
      asOf
    );

    const bySource = new Map(
      (result.by_source_type ?? []).map((row) => [row.source_type, row])
    );
    expect(bySource.get('notion')).toMatchObject({
      cohort_size: 1,
      eligible_7d: 1,
      returned_7d: 1,
      return_rate_7d_pct: 100,
    });
    expect(bySource.get('upload')).toMatchObject({
      cohort_size: 1,
      returned_7d: 0,
      return_rate_7d_pct: 0,
    });
    expect(bySource.get('google_drive')).toMatchObject({
      cohort_size: 1,
      returned_30d: 0,
    });
  });

  it('counts an identity once, under the source of its first conversion', () => {
    const first = daysBefore(NOW, 40);

    const result = computeReturnRates(
      [identity('u10', 'notion', first, daysAfter(first, 2))],
      asOf
    );

    expect(result.by_source_type).toHaveLength(1);
    expect(result.by_source_type?.[0].source_type).toBe('notion');
  });

  it('gives a source null rates for a window none of its identities finished', () => {
    const result = computeReturnRates(
      [identity('u11', 'upload', daysBefore(NOW, 9), null)],
      asOf
    );

    expect(result.by_source_type?.[0]).toMatchObject({
      eligible_14d: 0,
      return_rate_14d_pct: null,
      return_rate_30d_pct: null,
    });
  });

  it('returns null windows and no source breakdown for an empty cohort', () => {
    const result = computeReturnRates([], asOf);

    expect(result.overall).toEqual({ '7d': null, '14d': null, '30d': null });
    expect(result.eligible).toEqual({ '7d': 0, '14d': 0, '30d': 0 });
    expect(result.by_source_type).toBeNull();
    expect(result.as_of).toBe(asOf);
  });
});

describe('ReturnRateMetricsService — getMetrics', () => {
  function fakeDatabase(rows: unknown[]): Knex {
    return {
      raw: jest.fn().mockReturnValue({
        timeout: jest.fn().mockResolvedValue({ rows }),
      }),
    } as unknown as Knex;
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('turns database rows, whose timestamps arrive as Date objects, into rates', async () => {
    const first = daysBefore(NOW, 40);
    const service = new ReturnRateMetricsService(
      fakeDatabase([
        {
          owner: '1',
          source_type: 'notion',
          first_at: first,
          first_return_at: daysAfter(first, 3),
        },
        {
          owner: '2',
          source_type: 'notion',
          first_at: first,
          first_return_at: null,
        },
      ])
    );

    const result = await service.getMetrics();

    expect(result.overall['7d']).toBe(50);
    expect(result.eligible['7d']).toBe(2);
    expect(result.by_source_type?.[0]).toMatchObject({
      source_type: 'notion',
      cohort_size: 2,
    });
    expect(result.error).toBeUndefined();
  });

  it('returns null windows and surfaces the error when the query throws', async () => {
    const failing = { raw: jest.fn() } as unknown as Knex;
    const service = new ReturnRateMetricsService(failing);

    const result = await service.getMetrics();

    expect(result.by_source_type).toBeNull();
    expect(result.overall).toEqual({ '7d': null, '14d': null, '30d': null });
    expect(result.eligible).toEqual({ '7d': 0, '14d': 0, '30d': 0 });
    expect((result.error ?? '').length).toBeGreaterThan(0);
  });
});
