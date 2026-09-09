import { InMemoryBusinessMetricsCacheRepository } from '../../data_layer/BusinessMetricsCacheRepository';
import { BusinessMetricsResponse } from './BusinessMetricsService';
import { ConversionMetricsResponse } from './ConversionMetricsService';
import { PaidValueMonitorResponse } from './PaidValueMonitorService';
import { PassUnlockMonitorResponse } from './PassUnlockMonitorService';
import {
  TODAY_SNAPSHOT_CACHE_KEY,
  TodaySnapshotService,
  TodaySnapshotSources,
  buildScoreRows,
  evaluateStatus,
} from './TodaySnapshotService';

const business = (
  overrides: Partial<BusinessMetricsResponse> = {}
): BusinessMetricsResponse =>
  ({
    mrr_usd: 6000,
    net_new_mrr_mtd_usd: 100,
    active_paying_subs: 729,
    churn_30d_pct: 9.1,
    failed_payments_7d: 4,
    new_paid_conversions_7d: 15,
    pass_sales_7d: { day_passes: 10, week_passes: 8, semester_passes: 5 },
    mrr_timeseries: null,
    active_subs_timeseries: null,
    conversions_vs_churn_weekly: null,
    failed_payments_weekly: [
      { week: '2026-08-17', count: 2 },
      { week: '2026-08-24', count: 2 },
      { week: '2026-08-31', count: 9 },
    ],
    cancellation_reasons_top: null,
    cancellation_comments_recent: null,
    emoji_feedback_ratings: null,
    emoji_feedback_comments: null,
    reengagement_reasons_top: null,
    reengagement_comments_recent: null,
    signup_countries_90d: null,
    total_users: 14460,
    signups_24h: 30,
    signups_7d: 216,
    as_of: '2026-09-09T00:00:00.000Z',
    cache_age_seconds: 0,
    ...overrides,
  }) as BusinessMetricsResponse;

const conversion = (
  overrides: Partial<ConversionMetricsResponse> = {}
): ConversionMetricsResponse =>
  ({
    free_conversions_7d: 300,
    paid_conversions_7d: 90,
    free_conversion_success_rate_7d: 96,
    paid_conversion_success_rate_7d: 88,
    free_blocked_by_plan_7d: 0,
    paid_blocked_by_plan_7d: 0,
    conversion_errors_7d_top_reasons: [],
    failed_conversions_weekly: [],
    time_to_first_deck_median_minutes_30d: 12,
    upload_to_download_rate_7d: 61.5,
    deck_quality_cohorts_30d: null,
    ...overrides,
  }) as ConversionMetricsResponse;

const passUnlock = (missing: number): PassUnlockMonitorResponse => ({
  window_since: '2026-09-02T00:00:00.000Z',
  as_of: '2026-09-09T00:00:00.000Z',
  grace_minutes: 30,
  checked: 20,
  granted: 20 - missing,
  missing,
  pending: 0,
  missingPayments: [],
});

const paidValue = (
  zeroTried: number,
  zeroNever: number
): PaidValueMonitorResponse => {
  const group = {
    checked: 10,
    withValue: 10 - zeroTried - zeroNever,
    zeroValueTried: zeroTried,
    zeroValueNeverTried: zeroNever,
    rows: [],
  };
  return {
    window_since: '2026-09-02T00:00:00.000Z',
    as_of: '2026-09-09T00:00:00.000Z',
    passes: group,
    claimedAnonymousPasses: {
      ...group,
      zeroValueTried: 0,
      zeroValueNeverTried: 0,
    },
    unclaimedAnonymousPasses: 0,
    newSubscriptions: { ...group, zeroValueTried: 0, zeroValueNeverTried: 0 },
  };
};

const sourcesFor = (
  overrides: Partial<TodaySnapshotSources> = {}
): TodaySnapshotSources => ({
  business: async () => business(),
  conversion: async () => conversion(),
  unresolvedErrorGroups: async () => 0,
  passUnlock: async () => passUnlock(0),
  paidValue: async () => paidValue(0, 0),
  ...overrides,
});

describe('evaluateStatus', () => {
  it.each([
    [null, { at_least: 10 }, 'none'],
    [5, null, 'none'],
    [70, { at_least: 70 }, 'green'],
    [60, { at_least: 70 }, 'amber'],
    [50, { at_least: 70 }, 'red'],
    [7, { at_most: 7 }, 'green'],
    [8, { at_most: 7 }, 'amber'],
    [9.1, { at_most: 7 }, 'red'],
    [0, { at_most: 0 }, 'green'],
    [1, { at_most: 0 }, 'red'],
    [1, { at_most: 0, missedSeverity: 'amber' as const }, 'amber'],
  ])('value %s against %j is %s', (value, target, expected) => {
    expect(evaluateStatus(value, target)).toBe(expected);
  });
});

describe('buildScoreRows', () => {
  const rows = buildScoreRows({
    business: business(),
    conversion: conversion(),
    unresolvedErrorGroups: 3,
    passUnlock: passUnlock(1),
    paidValue: paidValue(2, 1),
  });
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

  it('sorts red before amber before green before untargeted', () => {
    const order = rows.map((row) => row.status);
    const rank = { red: 0, amber: 1, green: 2, none: 3 };
    for (let i = 1; i < order.length; i += 1) {
      expect(rank[order[i]]).toBeGreaterThanOrEqual(rank[order[i - 1]]);
    }
  });

  it('scores new paid against the 70/wk target as red at the baseline', () => {
    expect(byId.new_paid_7d).toMatchObject({
      value: 15,
      target: 70,
      target_direction: 'at_least',
      status: 'red',
      link: '/ops/business#revenue',
    });
  });

  it('sums the three pass kinds and meets the pass-sales hold target', () => {
    expect(byId.pass_sales_7d).toMatchObject({ value: 23, status: 'green' });
  });

  it('uses the lower of free and paid success rates', () => {
    expect(byId.conversion_success_7d_pct).toMatchObject({
      value: 88,
      status: 'amber',
      format: 'percent',
    });
  });

  it('flags a failed-payment spike against twice the prior-week average', () => {
    expect(byId.failed_payments_week).toMatchObject({
      value: 9,
      target: 4,
      target_direction: 'at_most',
      status: 'red',
      delta: 7,
      delta_good: false,
    });
  });

  it('leaves upload to download untargeted with a neutral status', () => {
    expect(byId.upload_to_download_7d).toMatchObject({
      value: 61.5,
      target: null,
      status: 'none',
    });
  });

  it('turns the two monitors into red and amber rows', () => {
    expect(byId.missing_pass_unlocks_7d).toMatchObject({
      value: 1,
      status: 'red',
      link: '/ops/business#pass-unlocks',
    });
    expect(byId.zero_value_paid_7d).toMatchObject({
      value: 3,
      status: 'amber',
    });
    expect(byId.unresolved_error_groups).toMatchObject({
      value: 3,
      status: 'red',
      link: '/ops/errors',
    });
  });

  it('renders every row with a null value when a source is missing', () => {
    const empty = buildScoreRows({
      business: null,
      conversion: null,
      unresolvedErrorGroups: null,
      passUnlock: null,
      paidValue: null,
    });
    expect(empty).toHaveLength(10);
    for (const row of empty) {
      expect(row.value).toBeNull();
      expect(row.status).toBe('none');
    }
  });

  it('does not flag failed payments when the prior weeks average zero', () => {
    const [row] = buildScoreRows({
      business: business({
        failed_payments_weekly: [
          { week: '2026-08-24', count: 0 },
          { week: '2026-08-31', count: 3 },
        ],
      }),
      conversion: null,
      unresolvedErrorGroups: null,
      passUnlock: null,
      paidValue: null,
    }).filter((r) => r.id === 'failed_payments_week');
    expect(row).toMatchObject({ value: 3, target: null, status: 'none' });
  });
});

describe('TodaySnapshotService', () => {
  const t0 = new Date('2026-09-09T10:00:00.000Z');

  it('computes, caches, and reports zero cache age on a cold start', async () => {
    const cache = new InMemoryBusinessMetricsCacheRepository();
    const service = new TodaySnapshotService(
      sourcesFor(),
      cache,
      5 * 60 * 1000,
      () => t0
    );
    const snapshot = await service.getSnapshot();
    expect(snapshot.rows).toHaveLength(10);
    expect(snapshot).toMatchObject({
      as_of: t0.toISOString(),
      cache_age_seconds: 0,
      stale: false,
      errors: [],
    });
    const entries = await cache.loadAll();
    expect(entries.map((e) => e.key)).toEqual([TODAY_SNAPSHOT_CACHE_KEY]);
  });

  it('serves the cached snapshot inside the TTL without recomputing', async () => {
    const cache = new InMemoryBusinessMetricsCacheRepository();
    const businessSource = jest.fn(async () => business());
    let now = t0;
    const service = new TodaySnapshotService(
      sourcesFor({ business: businessSource }),
      cache,
      5 * 60 * 1000,
      () => now
    );
    await service.getSnapshot();
    now = new Date(t0.getTime() + 90 * 1000);
    const second = await service.getSnapshot();
    expect(businessSource).toHaveBeenCalledTimes(1);
    expect(second.cache_age_seconds).toBe(90);
    expect(second.stale).toBe(false);
  });

  it('recomputes once the TTL has passed', async () => {
    const cache = new InMemoryBusinessMetricsCacheRepository();
    const businessSource = jest.fn(async () => business());
    let now = t0;
    const service = new TodaySnapshotService(
      sourcesFor({ business: businessSource }),
      cache,
      5 * 60 * 1000,
      () => now
    );
    await service.getSnapshot();
    now = new Date(t0.getTime() + 6 * 60 * 1000);
    await service.getSnapshot();
    expect(businessSource).toHaveBeenCalledTimes(2);
  });

  it('records a failed source as an error and nulls only its rows', async () => {
    const service = new TodaySnapshotService(
      sourcesFor({
        passUnlock: async () => {
          throw new Error('stripe timeout');
        },
      }),
      new InMemoryBusinessMetricsCacheRepository(),
      5 * 60 * 1000,
      () => t0
    );
    const snapshot = await service.getSnapshot();
    expect(snapshot.errors).toEqual([
      { source: 'pass_unlock', message: 'stripe timeout' },
    ]);
    const unlock = snapshot.rows.find(
      (r) => r.id === 'missing_pass_unlocks_7d'
    );
    expect(unlock?.value).toBeNull();
    expect(snapshot.rows.find((r) => r.id === 'new_paid_7d')?.value).toBe(15);
  });

  it('serves the stale snapshot when every source fails after expiry', async () => {
    const cache = new InMemoryBusinessMetricsCacheRepository();
    let failing = false;
    const boom = async (): Promise<never> => {
      throw new Error('db down');
    };
    let now = t0;
    const service = new TodaySnapshotService(
      {
        business: () => (failing ? boom() : Promise.resolve(business())),
        conversion: () => (failing ? boom() : Promise.resolve(conversion())),
        unresolvedErrorGroups: () => (failing ? boom() : Promise.resolve(0)),
        passUnlock: () => (failing ? boom() : Promise.resolve(passUnlock(0))),
        paidValue: () => (failing ? boom() : Promise.resolve(paidValue(0, 0))),
      },
      cache,
      5 * 60 * 1000,
      () => now
    );
    await service.getSnapshot();
    failing = true;
    now = new Date(t0.getTime() + 10 * 60 * 1000);
    const stale = await service.getSnapshot();
    expect(stale.stale).toBe(true);
    expect(stale.cache_age_seconds).toBe(600);
    expect(stale.rows).toHaveLength(10);
  });

  it('throws when every source fails and nothing is cached', async () => {
    const boom = async (): Promise<never> => {
      throw new Error('db down');
    };
    const service = new TodaySnapshotService(
      {
        business: boom,
        conversion: boom,
        unresolvedErrorGroups: boom,
        passUnlock: boom,
        paidValue: boom,
      },
      new InMemoryBusinessMetricsCacheRepository(),
      5 * 60 * 1000,
      () => t0
    );
    await expect(service.getSnapshot()).rejects.toThrow(
      'every today-snapshot source failed'
    );
  });
});
