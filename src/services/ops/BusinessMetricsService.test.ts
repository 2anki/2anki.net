jest.mock('../../lib/integrations/stripe', () => ({
  getStripe: jest.fn(),
}));

import { InMemoryEmojiFeedbackRepository } from '../../data_layer/EmojiFeedbackRepository';
import {
  BusinessMetricsService,
  BusinessMetricsServiceDeps,
  BusinessMetricsResponse,
} from './BusinessMetricsService';
import { InMemoryBusinessMetricsCacheRepository } from '../../data_layer/BusinessMetricsCacheRepository';
import { InMemoryCancellationFeedbackRepository } from '../../data_layer/CancellationFeedbackRepository';
import {
  InMemoryUserSignupCountsRepository,
  IUserSignupCountsRepository,
} from '../../data_layer/UsersRepository';
import { InMemorySubscriptionsSourceRepository } from '../../data_layer/SubscriptionsSourceRepository';

interface FakeSubscriptionItem {
  price: {
    unit_amount: number | null;
    recurring: {
      interval: 'day' | 'week' | 'month' | 'year';
      interval_count?: number;
    } | null;
  };
  quantity?: number;
}

interface FakeSubscription {
  id: string;
  status?: 'active' | 'canceled' | 'trialing' | 'past_due';
  created?: number;
  canceled_at?: number | null;
  ended_at?: number | null;
  pause_collection?: { behavior: string; resumes_at: number } | null;
  items: { data: FakeSubscriptionItem[] };
}

const monthly = (
  cents: number,
  quantity: number = 1,
  intervalCount: number = 1
): FakeSubscriptionItem => ({
  price: {
    unit_amount: cents,
    recurring: { interval: 'month', interval_count: intervalCount },
  },
  quantity,
});

const yearly = (cents: number, quantity: number = 1): FakeSubscriptionItem => ({
  price: {
    unit_amount: cents,
    recurring: { interval: 'year', interval_count: 1 },
  },
  quantity,
});

const weekly = (cents: number): FakeSubscriptionItem => ({
  price: {
    unit_amount: cents,
    recurring: { interval: 'week', interval_count: 1 },
  },
  quantity: 1,
});

const NOW_ISO = '2026-05-09T14:32:07Z';
const NOW_MS = new Date(NOW_ISO).getTime();
const SECONDS_PER_DAY = 24 * 60 * 60;
const daysAgoEpoch = (days: number): number =>
  Math.floor(NOW_MS / 1000) - days * SECONDS_PER_DAY;

const sub = (
  id: string,
  items: FakeSubscriptionItem[],
  overrides: Partial<FakeSubscription> = {}
): FakeSubscription => ({
  id,
  status: overrides.status ?? 'active',
  created: overrides.created ?? daysAgoEpoch(120),
  canceled_at: overrides.canceled_at ?? null,
  ended_at: overrides.ended_at ?? null,
  pause_collection: overrides.pause_collection ?? null,
  items: { data: items },
});

interface FakeStripeOptions {
  allSubs?: FakeSubscription[];
  invoices?: Array<{
    id: string;
    status: string;
    attempt_count: number;
    created?: number;
  }>;
}

const buildFakeStripe = (options: FakeStripeOptions = {}) => {
  const invoicesList = jest.fn(async () => ({
    data: options.invoices ?? [],
    has_more: false,
  }));
  return {
    invoices: { list: invoicesList },
  };
};

// Subscriptions now come from the local `subscriptions` table (via the
// repository), not a live Stripe pagination — so the DB-backed money metrics
// can never silently freeze on a Stripe timeout. Tests feed the same fixtures
// through an in-memory source repository.
const buildService = (
  options: FakeStripeOptions = {},
  extraDeps: Partial<BusinessMetricsServiceDeps> = {}
) => {
  const stripe = buildFakeStripe(options);
  const subscriptionsRepository = new InMemorySubscriptionsSourceRepository(
    (options.allSubs ?? []) as unknown[]
  );
  const listSpy = jest.spyOn(subscriptionsRepository, 'listPayloads');
  const service = new BusinessMetricsService({
    stripeFactory: () => stripe as never,
    subscriptionsRepository,
    ...extraDeps,
  });
  return { stripe, service, subscriptionsRepository, listSpy };
};

describe('BusinessMetricsService', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW_MS,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('surfaces 7-day pass sales when a pass-sales repository is injected', async () => {
    const passSalesSince = jest
      .fn()
      .mockResolvedValue({ day_passes: 5, week_passes: 2 });
    const { service } = buildService(
      {},
      { passSalesRepository: { passSalesSince } }
    );

    const response = await service.getMetrics();

    expect(response.pass_sales_7d).toEqual({ day_passes: 5, week_passes: 2 });
    const since = passSalesSince.mock.calls[0][0] as Date;
    expect(Date.now() - since.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('computes happy score for 7, 30 and 90 day windows with asks from the events repo', async () => {
    const emoji = new InMemoryEmojiFeedbackRepository();
    for (let i = 0; i < 12; i += 1) {
      await emoji.insert({ rating: 5, comment: null, page: 'p', email: null });
    }
    for (let i = 0; i < 3; i += 1) {
      await emoji.insert({ rating: 1, comment: null, page: 'p', email: null });
    }
    const countByName = jest.fn(async (name: string, since: Date) => {
      expect(name).toBe('happy_score_ask_shown');
      const days = Math.round((NOW_MS - since.getTime()) / 86_400_000);
      return days * 10;
    });
    const { service } = buildService(
      {},
      {
        emojiFeedbackRepository: emoji,
        happyScoreAskRepository: { countByName },
      }
    );

    const response = await service.getMetrics();

    expect(response.happy_score).toEqual([
      expect.objectContaining({
        window: '7d',
        love: 12,
        low: 3,
        n: 15,
        score_pct: 80,
        asks: 70,
        response_rate_pct: 21.4,
      }),
      expect.objectContaining({ window: '30d', asks: 300, score_pct: 80 }),
      expect.objectContaining({ window: '90d', asks: 900, score_pct: 80 }),
    ]);
  });

  it('reports happy score windows with unknown asks when no events repo is injected', async () => {
    const { service } = buildService();
    const response = await service.getMetrics();
    expect(response.happy_score).toEqual([
      expect.objectContaining({
        window: '7d',
        n: 0,
        score_pct: null,
        asks: null,
      }),
      expect.objectContaining({ window: '30d', asks: null }),
      expect.objectContaining({ window: '90d', asks: null }),
    ]);
  });

  it('returns null pass sales without a repository', async () => {
    const { service } = buildService();
    const response = await service.getMetrics();
    expect(response.pass_sales_7d).toBeNull();
  });

  it('returns the full response shape on first call', async () => {
    const { service } = buildService({
      allSubs: [
        sub('sub_1', [monthly(2000)], { created: daysAgoEpoch(60) }),
        sub('sub_2', [monthly(2820)], { created: daysAgoEpoch(45) }),
        sub('sub_new1', [monthly(312_00)], { created: daysAgoEpoch(2) }),
        ...Array.from({ length: 10 }).map((_, i) =>
          sub(`sub_n_${i}`, [monthly(1000)], { created: daysAgoEpoch(3) })
        ),
        ...Array.from({ length: 4 }).map((_, i) =>
          sub(`sub_c_${i}`, [monthly(500)], {
            created: daysAgoEpoch(60),
            canceled_at: daysAgoEpoch(5),
            ended_at: daysAgoEpoch(5),
            status: 'canceled',
          })
        ),
      ],
      invoices: [
        {
          id: 'inv_1',
          status: 'open',
          attempt_count: 1,
          created: daysAgoEpoch(1),
        },
        {
          id: 'inv_2',
          status: 'open',
          attempt_count: 1,
          created: daysAgoEpoch(2),
        },
        {
          id: 'inv_3',
          status: 'open',
          attempt_count: 1,
          created: daysAgoEpoch(3),
        },
        {
          id: 'inv_4',
          status: 'open',
          attempt_count: 1,
          created: daysAgoEpoch(6),
        },
        {
          id: 'inv_paid',
          status: 'paid',
          attempt_count: 0,
          created: daysAgoEpoch(1),
        },
      ],
    });

    const result: BusinessMetricsResponse = await service.getMetrics();

    expect(result.mrr_usd).toBeCloseTo(20 + 28.2 + 312 + 10 * 10, 5);
    expect(result.active_paying_subs).toBe(13);
    expect(result.net_new_mrr_mtd_usd).toBeGreaterThan(0);
    expect(result.new_paid_conversions_7d).toBe(11);
    expect(result.churn_30d_pct).toBeCloseTo((4 / 13) * 100, 5);
    expect(result.failed_payments_7d).toBe(4);
    expect(result.as_of).toBe('2026-05-09T14:32:07.000Z');
    expect(result.cache_age_seconds).toBe(0);
    expect(result.errors).toBeUndefined();
    expect(result.mrr_timeseries).toHaveLength(90);
    expect(result.active_subs_timeseries).toHaveLength(90);
    expect(result.conversions_vs_churn_weekly).toHaveLength(12);
    expect(result.failed_payments_weekly).toHaveLength(12);
  });

  it('excludes paused subscriptions from active count, MRR, and churn', async () => {
    const futureResume = daysAgoEpoch(-60);
    const { service } = buildService({
      allSubs: [
        sub('sub_active', [monthly(2000)], { created: daysAgoEpoch(90) }),
        sub('sub_paused', [monthly(2000)], {
          created: daysAgoEpoch(90),
          status: 'active',
          pause_collection: { behavior: 'void', resumes_at: futureResume },
        }),
        sub('sub_churned', [monthly(2000)], {
          created: daysAgoEpoch(90),
          canceled_at: daysAgoEpoch(5),
          ended_at: daysAgoEpoch(5),
          status: 'canceled',
        }),
      ],
    });

    const result = await service.getMetrics();

    expect(result.active_paying_subs).toBe(1);
    expect(result.mrr_usd).toBeCloseTo(20, 5);
    expect(result.churn_30d_pct).toBeCloseTo((1 / 1) * 100, 5);
  });

  it('serves cached values within 15 minutes', async () => {
    const { stripe, service, listSpy } = buildService({
      allSubs: [sub('sub_1', [monthly(1000)], { created: daysAgoEpoch(60) })],
    });

    await service.getMetrics();
    jest.advanceTimersByTime(10 * 60 * 1000);
    const second = await service.getMetrics();

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(stripe.invoices.list).toHaveBeenCalledTimes(1);
    expect(second.cache_age_seconds).toBe(10 * 60);
  });

  it('reuses a shared cache repository across service instances (survives restart)', async () => {
    const sharedCache = new InMemoryBusinessMetricsCacheRepository();

    const { service: first } = buildService(
      {
        allSubs: [sub('sub_1', [monthly(1000)], { created: daysAgoEpoch(60) })],
      },
      { cacheRepository: sharedCache }
    );
    await first.getMetrics();

    const { service: second, listSpy: secondSpy } = buildService(
      {
        allSubs: [sub('sub_1', [monthly(1000)], { created: daysAgoEpoch(60) })],
      },
      { cacheRepository: sharedCache }
    );
    const result = await second.getMetrics();

    expect(secondSpy).not.toHaveBeenCalled();
    expect(result.mrr_usd).toBeCloseTo(10, 5);
    expect(result.cache_age_seconds).toBe(0);
  });

  it('refetches metrics after cache expires', async () => {
    const { stripe, service, listSpy } = buildService({
      allSubs: [sub('sub_1', [monthly(1000)], { created: daysAgoEpoch(60) })],
    });

    await service.getMetrics();
    jest.advanceTimersByTime(16 * 60 * 1000);
    await service.getMetrics();

    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(stripe.invoices.list).toHaveBeenCalledTimes(2);
  });

  it('normalizes yearly and weekly subs into monthly MRR', async () => {
    const { service } = buildService({
      allSubs: [
        sub('sub_year', [yearly(120_00)], { created: daysAgoEpoch(60) }),
        sub('sub_week', [weekly(1000)], { created: daysAgoEpoch(60) }),
      ],
    });

    const result = await service.getMetrics();
    const expectedYearly = 12000 / 12;
    const expectedWeekly = 1000 * 4.33;
    const expectedUsd = (expectedYearly + expectedWeekly) / 100;
    expect(result.mrr_usd).toBeCloseTo(expectedUsd, 5);
    expect(result.active_paying_subs).toBe(2);
  });

  it('excludes trialing subscriptions from MRR and active count', async () => {
    const { service } = buildService({
      allSubs: [
        sub('sub_active', [monthly(1500)], { created: daysAgoEpoch(60) }),
        sub('sub_trialing', [monthly(99_99)], {
          created: daysAgoEpoch(60),
          status: 'trialing',
        }),
      ],
    });

    const result = await service.getMetrics();
    expect(result.active_paying_subs).toBe(1);
    expect(result.mrr_usd).toBeCloseTo(15, 5);
  });

  it('sums MRR across multiple items in one subscription', async () => {
    const { service } = buildService({
      allSubs: [
        sub('sub_multi', [monthly(1000, 2), monthly(500)], {
          created: daysAgoEpoch(60),
        }),
      ],
    });

    const result = await service.getMetrics();
    expect(result.mrr_usd).toBeCloseTo(25, 5);
    expect(result.active_paying_subs).toBe(1);
  });

  it('reads the subscriptions source once for all sub-derived metrics', async () => {
    const { service, listSpy } = buildService({
      allSubs: [sub('sub_1', [monthly(1000)], { created: daysAgoEpoch(60) })],
    });

    await service.getMetrics();

    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('returns null and reports the metric in errors on partial failure', async () => {
    const { stripe, service } = buildService({
      allSubs: [sub('sub_1', [monthly(1000)], { created: daysAgoEpoch(60) })],
    });
    (stripe.invoices.list as jest.Mock).mockRejectedValueOnce(
      new Error('stripe boom')
    );

    const result = await service.getMetrics();

    expect(result.failed_payments_7d).toBeNull();
    expect(result.failed_payments_weekly).toBeNull();
    expect(result.mrr_usd).toBeCloseTo(10, 5);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metric: 'failed_payments_7d',
          message: 'stripe boom',
        }),
      ])
    );
  });

  it('counts only open invoices with attempts as failed payments', async () => {
    const { service } = buildService({
      invoices: [
        {
          id: 'inv_open_attempts',
          status: 'open',
          attempt_count: 2,
          created: daysAgoEpoch(1),
        },
        {
          id: 'inv_open_no_attempt',
          status: 'open',
          attempt_count: 0,
          created: daysAgoEpoch(1),
        },
        {
          id: 'inv_paid',
          status: 'paid',
          attempt_count: 3,
          created: daysAgoEpoch(1),
        },
        {
          id: 'inv_void',
          status: 'void',
          attempt_count: 1,
          created: daysAgoEpoch(1),
        },
      ],
    });

    const result = await service.getMetrics();
    expect(result.failed_payments_7d).toBe(1);
  });

  describe('time-series', () => {
    it('mrr_timeseries reflects the active-on-day rule', async () => {
      const createdLongAgo = daysAgoEpoch(80);
      const canceledRecently = daysAgoEpoch(10);
      const { service } = buildService({
        allSubs: [
          sub('sub_long', [monthly(1000)], {
            created: createdLongAgo,
            canceled_at: canceledRecently,
            ended_at: canceledRecently,
            status: 'canceled',
          }),
          sub('sub_active', [monthly(2000)], {
            created: daysAgoEpoch(20),
          }),
        ],
      });

      const result = await service.getMetrics();
      const series = result.mrr_timeseries!;
      expect(series).toHaveLength(90);

      const findDay = (daysBack: number) => {
        const target = new Date(NOW_MS);
        target.setUTCHours(0, 0, 0, 0);
        target.setUTCDate(target.getUTCDate() - daysBack);
        const iso = target.toISOString().slice(0, 10);
        return series.find((p) => p.t === iso);
      };

      expect(findDay(70)?.mrr_usd).toBeCloseTo(10, 5);
      expect(findDay(15)?.mrr_usd).toBeCloseTo(30, 5);
      expect(findDay(5)?.mrr_usd).toBeCloseTo(20, 5);
      expect(findDay(89)?.mrr_usd).toBe(0);
    });

    it('active_subs_timeseries trajectory matches creates/cancels', async () => {
      const { service } = buildService({
        allSubs: [
          sub('sub_a', [monthly(1000)], {
            created: daysAgoEpoch(40),
            canceled_at: daysAgoEpoch(10),
            ended_at: daysAgoEpoch(10),
            status: 'canceled',
          }),
          sub('sub_b', [monthly(1000)], {
            created: daysAgoEpoch(20),
          }),
        ],
      });

      const result = await service.getMetrics();
      const series = result.active_subs_timeseries!;
      const findDay = (daysBack: number) => {
        const target = new Date(NOW_MS);
        target.setUTCHours(0, 0, 0, 0);
        target.setUTCDate(target.getUTCDate() - daysBack);
        const iso = target.toISOString().slice(0, 10);
        return series.find((p) => p.t === iso);
      };

      expect(findDay(50)?.active_paying_subs).toBe(0);
      expect(findDay(30)?.active_paying_subs).toBe(1);
      expect(findDay(15)?.active_paying_subs).toBe(2);
      expect(findDay(5)?.active_paying_subs).toBe(1);
    });

    it('excludes a paused subscription from the today point of both series', async () => {
      const { service } = buildService({
        allSubs: [
          sub('sub_active', [monthly(1000)], { created: daysAgoEpoch(90) }),
          sub('sub_paused', [monthly(2000)], {
            created: daysAgoEpoch(90),
            status: 'active',
            pause_collection: {
              behavior: 'void',
              resumes_at: daysAgoEpoch(-60),
            },
          }),
        ],
      });

      const result = await service.getMetrics();
      const target = new Date(NOW_MS);
      target.setUTCHours(0, 0, 0, 0);
      const todayIso = target.toISOString().slice(0, 10);
      const mrrToday = result.mrr_timeseries!.find((p) => p.t === todayIso);
      const activeToday = result.active_subs_timeseries!.find(
        (p) => p.t === todayIso
      );

      expect(result.mrr_usd).toBeCloseTo(10, 5);
      expect(result.active_paying_subs).toBe(1);
      expect(mrrToday?.mrr_usd).toBeCloseTo(10, 5);
      expect(activeToday?.active_paying_subs).toBe(1);
    });

    it('conversions_vs_churn_weekly bins by ISO week', async () => {
      const oneWeek = 7 * SECONDS_PER_DAY;
      const { service } = buildService({
        allSubs: [
          sub('sub_w0_a', [monthly(500)], {
            created: daysAgoEpoch(2),
          }),
          sub('sub_w0_b', [monthly(500)], {
            created: daysAgoEpoch(3),
          }),
          sub('sub_w1', [monthly(500)], {
            created: daysAgoEpoch(2) - oneWeek,
          }),
          sub('sub_churn_w0', [monthly(500)], {
            created: daysAgoEpoch(120),
            canceled_at: daysAgoEpoch(2),
            ended_at: daysAgoEpoch(2),
            status: 'canceled',
          }),
          sub('sub_trialing_w0', [monthly(500)], {
            created: daysAgoEpoch(2),
            status: 'trialing',
          }),
        ],
      });

      const result = await service.getMetrics();
      const weekly = result.conversions_vs_churn_weekly!;
      expect(weekly).toHaveLength(12);

      const totalNew = weekly.reduce((acc, w) => acc + w.new_paying, 0);
      const totalChurned = weekly.reduce((acc, w) => acc + w.churned, 0);
      expect(totalNew).toBe(3);
      expect(totalChurned).toBe(1);

      const last = weekly[weekly.length - 1];
      const prev = weekly[weekly.length - 2];
      expect(last.new_paying + prev.new_paying).toBe(3);
      expect(last.churned + prev.churned).toBe(1);
    });

    it('failed_payments_weekly bins invoices by ISO week of created', async () => {
      const { service } = buildService({
        invoices: [
          {
            id: 'i1',
            status: 'open',
            attempt_count: 1,
            created: daysAgoEpoch(1),
          },
          {
            id: 'i2',
            status: 'open',
            attempt_count: 2,
            created: daysAgoEpoch(2),
          },
          {
            id: 'i3',
            status: 'open',
            attempt_count: 1,
            created: daysAgoEpoch(10),
          },
          {
            id: 'i_paid',
            status: 'paid',
            attempt_count: 1,
            created: daysAgoEpoch(2),
          },
        ],
      });

      const result = await service.getMetrics();
      const weekly = result.failed_payments_weekly!;
      expect(weekly).toHaveLength(12);
      const total = weekly.reduce((acc, w) => acc + w.count, 0);
      expect(total).toBe(3);
    });

    it('caches time-series — second call within 15 min does not refetch', async () => {
      const { stripe, service, listSpy } = buildService({
        allSubs: [sub('sub_1', [monthly(1000)], { created: daysAgoEpoch(60) })],
        invoices: [
          {
            id: 'i1',
            status: 'open',
            attempt_count: 1,
            created: daysAgoEpoch(1),
          },
        ],
      });

      const first = await service.getMetrics();
      jest.advanceTimersByTime(10 * 60 * 1000);
      const second = await service.getMetrics();

      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(stripe.invoices.list).toHaveBeenCalledTimes(1);
      expect(second.mrr_timeseries).toEqual(first.mrr_timeseries);
      expect(second.failed_payments_weekly).toEqual(
        first.failed_payments_weekly
      );
    });
  });

  describe('source-data cache (subs/invoices)', () => {
    it('caches subs and invoices as source-data entries, not per-metric', async () => {
      const cache = new InMemoryBusinessMetricsCacheRepository();
      const { service } = buildService(
        {
          allSubs: [
            sub('sub_1', [monthly(1000)], { created: daysAgoEpoch(60) }),
          ],
          invoices: [
            {
              id: 'inv_1',
              status: 'open',
              attempt_count: 1,
              created: daysAgoEpoch(1),
            },
          ],
        },
        { cacheRepository: cache }
      );

      await service.getMetrics();

      const cached = await cache.loadAll();
      const keys = cached.map((e) => e.key).sort();
      expect(keys).toEqual(
        expect.arrayContaining(['_stripe_subs', '_stripe_invoices'])
      );
      // None of the source-derived per-metric keys should be cached anymore
      expect(keys).not.toContain('mrr_usd');
      expect(keys).not.toContain('failed_payments_7d');
    });

    it('serves stale cache immediately and refreshes in the background', async () => {
      const { service, listSpy } = buildService({
        allSubs: [sub('sub_1', [monthly(1000)], { created: daysAgoEpoch(60) })],
      });

      await service.getMetrics();
      expect(listSpy).toHaveBeenCalledTimes(1);

      // Past TTL — second call should NOT block but should kick a background refresh
      jest.advanceTimersByTime(16 * 60 * 1000);
      const second = await service.getMetrics();
      // Stale data returned immediately; cache_age_seconds reflects the staleness
      expect(second.mrr_usd).toBeCloseTo(10, 5);
      expect(second.cache_age_seconds).toBeGreaterThanOrEqual(16 * 60);

      // The background refresh should have started (source read a second time)
      await service.waitForInflightRefresh();
      expect(listSpy).toHaveBeenCalledTimes(2);
    });

    it('single-flights concurrent refreshes (one source read, not two)', async () => {
      const { stripe, service, listSpy } = buildService({
        allSubs: [sub('sub_1', [monthly(1000)], { created: daysAgoEpoch(60) })],
      });

      const [a, b] = await Promise.all([
        service.getMetrics(),
        service.getMetrics(),
      ]);

      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(stripe.invoices.list).toHaveBeenCalledTimes(1);
      expect(a.mrr_usd).toBe(b.mrr_usd);
    });

    it('cold start with the subscriptions source failing still returns invoice-derived metrics', async () => {
      const subscriptionsRepository =
        new InMemorySubscriptionsSourceRepository();
      jest
        .spyOn(subscriptionsRepository, 'listPayloads')
        .mockRejectedValueOnce(new Error('subs boom'));
      const { service } = buildService(
        {
          invoices: [
            {
              id: 'inv_1',
              status: 'open',
              attempt_count: 1,
              created: daysAgoEpoch(1),
            },
          ],
        },
        { subscriptionsRepository }
      );

      const result = await service.getMetrics();

      expect(result.mrr_usd).toBeNull();
      expect(result.active_paying_subs).toBeNull();
      expect(result.failed_payments_7d).toBe(1);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ metric: 'mrr_usd', message: 'subs boom' }),
        ])
      );
    });

    it('ignores malformed subscription payloads instead of throwing', async () => {
      const subscriptionsRepository = new InMemorySubscriptionsSourceRepository(
        [
          sub('sub_ok', [monthly(1000)], { created: daysAgoEpoch(60) }),
          null,
          'not json',
          { id: 'missing_fields' },
        ]
      );
      const { service } = buildService({}, { subscriptionsRepository });

      const result = await service.getMetrics();

      expect(result.mrr_usd).toBeCloseTo(10, 5);
      expect(result.active_paying_subs).toBe(1);
      expect(result.errors).toBeUndefined();
    });

    it('parses subscription payloads stored as JSON strings', async () => {
      const subscriptionsRepository = new InMemorySubscriptionsSourceRepository(
        [
          JSON.stringify(
            sub('sub_str', [monthly(2500)], { created: daysAgoEpoch(60) })
          ),
        ]
      );
      const { service } = buildService({}, { subscriptionsRepository });

      const result = await service.getMetrics();

      expect(result.mrr_usd).toBeCloseTo(25, 5);
      expect(result.active_paying_subs).toBe(1);
    });
  });

  describe('cancellation feedback', () => {
    it('returns top reasons (last 90 days) and recent comments from the repo', async () => {
      const cancellationRepo = new InMemoryCancellationFeedbackRepository();
      const inWindow = new Date(NOW_MS - 5 * SECONDS_PER_DAY * 1000);
      const tooOld = new Date(NOW_MS - 100 * SECONDS_PER_DAY * 1000);

      cancellationRepo.insert({
        reason: 'Too expensive',
        created_at: inWindow,
      });
      cancellationRepo.insert({
        reason: 'Too expensive',
        created_at: inWindow,
      });
      cancellationRepo.insert({
        reason: "I don't use it enough",
        created_at: inWindow,
      });
      cancellationRepo.insert({
        reason: 'Other',
        comment: 'missed Anki shared decks',
        created_at: inWindow,
      });
      cancellationRepo.insert({
        reason: 'Too expensive',
        created_at: tooOld,
      });

      const { service } = buildService(
        {},
        { cancellationRepository: cancellationRepo }
      );

      const result = await service.getMetrics();

      expect(result.cancellation_reasons_top).toEqual([
        { reason: 'Too expensive', count: 2 },
        { reason: "I don't use it enough", count: 1 },
        { reason: 'Other', count: 1 },
      ]);
      expect(result.cancellation_comments_recent).toEqual([
        {
          reason: 'Other',
          comment: 'missed Anki shared decks',
          created_at: inWindow.toISOString(),
        },
      ]);
    });

    it('caches cancellation metrics within the TTL', async () => {
      const cancellationRepo = new InMemoryCancellationFeedbackRepository();
      cancellationRepo.insert({
        reason: 'Too expensive',
        created_at: new Date(NOW_MS - 1000),
      });
      const countSpy = jest.spyOn(cancellationRepo, 'countByReason');
      const commentsSpy = jest.spyOn(cancellationRepo, 'recentComments');

      const { service } = buildService(
        {},
        { cancellationRepository: cancellationRepo }
      );

      await service.getMetrics();
      jest.advanceTimersByTime(10 * 60 * 1000);
      await service.getMetrics();

      expect(countSpy).toHaveBeenCalledTimes(1);
      expect(commentsSpy).toHaveBeenCalledTimes(1);
    });

    it('reports a per-metric error and returns null when the repo throws', async () => {
      const cancellationRepo: InMemoryCancellationFeedbackRepository =
        new InMemoryCancellationFeedbackRepository();
      jest
        .spyOn(cancellationRepo, 'countByReason')
        .mockRejectedValueOnce(new Error('db down'));

      const { service } = buildService(
        {},
        { cancellationRepository: cancellationRepo }
      );

      const result = await service.getMetrics();

      expect(result.cancellation_reasons_top).toBeNull();
      expect(result.cancellation_comments_recent).toEqual([]);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            metric: 'cancellation_reasons_top',
            message: 'db down',
          }),
        ])
      );
    });
  });

  describe('signup counts', () => {
    it('returns total users plus 24h and 7d signup windows from the repo', async () => {
      const signupCountsRepo = new InMemoryUserSignupCountsRepository();
      signupCountsRepo.setTotalUsers(19389);
      signupCountsRepo.addSignup(
        new Date(NOW_MS - 1 * SECONDS_PER_DAY * 1000 + 1000)
      );
      signupCountsRepo.addSignup(new Date(NOW_MS - 3 * SECONDS_PER_DAY * 1000));
      signupCountsRepo.addSignup(new Date(NOW_MS - 6 * SECONDS_PER_DAY * 1000));
      signupCountsRepo.addSignup(
        new Date(NOW_MS - 10 * SECONDS_PER_DAY * 1000)
      );

      const { service } = buildService(
        {},
        { signupCountsRepository: signupCountsRepo }
      );

      const result = await service.getMetrics();

      expect(result.total_users).toBe(19389);
      expect(result.signups_24h).toBe(1);
      expect(result.signups_7d).toBe(3);
    });

    it('caches signup counts within the TTL', async () => {
      const signupCountsRepo = new InMemoryUserSignupCountsRepository();
      signupCountsRepo.setTotalUsers(5);
      const totalSpy = jest.spyOn(signupCountsRepo, 'countTotalUsers');
      const sinceSpy = jest.spyOn(signupCountsRepo, 'countSignupsSince');

      const { service } = buildService(
        {},
        { signupCountsRepository: signupCountsRepo }
      );

      await service.getMetrics();
      jest.advanceTimersByTime(10 * 60 * 1000);
      await service.getMetrics();

      expect(totalSpy).toHaveBeenCalledTimes(1);
      expect(sinceSpy).toHaveBeenCalledTimes(2);
    });

    it('reports a per-metric error and nulls the windows when total count throws', async () => {
      const signupCountsRepo: IUserSignupCountsRepository =
        new InMemoryUserSignupCountsRepository();
      jest
        .spyOn(signupCountsRepo, 'countTotalUsers')
        .mockRejectedValueOnce(new Error('counts down'));

      const { service } = buildService(
        {},
        { signupCountsRepository: signupCountsRepo }
      );

      const result = await service.getMetrics();

      expect(result.total_users).toBeNull();
      expect(result.mrr_usd).toBeCloseTo(0, 5);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            metric: 'total_users',
            message: 'counts down',
          }),
        ])
      );
    });

    it('omits the signup metrics when no counts repo is wired', async () => {
      const { service } = buildService({});

      const result = await service.getMetrics();

      expect(result.total_users).toBeNull();
      expect(result.signups_24h).toBeNull();
      expect(result.signups_7d).toBeNull();
    });
  });
});
