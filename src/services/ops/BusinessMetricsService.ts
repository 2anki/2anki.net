import type { Stripe } from 'stripe';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

import { getStripe } from '../../lib/integrations/stripe';
import { isPaused } from '../../lib/subscriptions/isPaused';
import {
  BusinessCacheKey,
  BusinessMetricsCacheEntry,
  IBusinessMetricsCacheRepository,
  InMemoryBusinessMetricsCacheRepository,
} from '../../data_layer/BusinessMetricsCacheRepository';
import {
  CancellationCommentEntry,
  CancellationReasonCount,
  ICancellationFeedbackRepository,
  InMemoryCancellationFeedbackRepository,
} from '../../data_layer/CancellationFeedbackRepository';
import {
  EmojiFeedbackCommentEntry,
  EmojiFeedbackRatingCount,
  IEmojiFeedbackRepository,
  InMemoryEmojiFeedbackRepository,
} from '../../data_layer/EmojiFeedbackRepository';
import {
  computeHappyScore,
  HAPPY_SCORE_ASK_EVENT,
  HAPPY_SCORE_WINDOWS,
  HappyScoreWindow,
} from '../../lib/happyScore';
import {
  IReEngagementFeedbackRepository,
  InMemoryReEngagementFeedbackRepository,
  ReEngagementCommentEntry,
  ReEngagementReasonCount,
} from '../../data_layer/ReEngagementFeedbackRepository';
import {
  ISignupCountryRepository,
  IUserSignupCountsRepository,
  SignupCountryCount,
} from '../../data_layer/UsersRepository';
import {
  ISubscriptionsSourceRepository,
  InMemorySubscriptionsSourceRepository,
} from '../../data_layer/SubscriptionsSourceRepository';
import type {
  IPassSalesRepository,
  PassSalesCounts,
} from '../../data_layer/EventsMetricsRepository';

export type BusinessMetricKey =
  | 'mrr_usd'
  | 'net_new_mrr_mtd_usd'
  | 'active_paying_subs'
  | 'churn_30d_pct'
  | 'failed_payments_7d'
  | 'new_paid_conversions_7d'
  | 'mrr_timeseries'
  | 'active_subs_timeseries'
  | 'conversions_vs_churn_weekly'
  | 'failed_payments_weekly'
  | 'cancellation_reasons_top'
  | 'cancellation_comments_recent'
  | 'emoji_feedback_ratings'
  | 'emoji_feedback_comments'
  | 'happy_score'
  | 'reengagement_reasons_top'
  | 'reengagement_comments_recent'
  | 'signup_countries_90d'
  | 'total_users'
  | 'signups_24h'
  | 'signups_7d'
  | 'pass_sales_7d';

export interface BusinessMetricError {
  metric: BusinessMetricKey;
  message: string;
}

export interface MrrTimeseriesPoint {
  t: string;
  mrr_usd: number;
}

export interface ActiveSubsTimeseriesPoint {
  t: string;
  active_paying_subs: number;
}

export interface ConversionsChurnWeekPoint {
  week: string;
  new_paying: number;
  churned: number;
}

export interface FailedPaymentsWeekPoint {
  week: string;
  count: number;
}

export interface BusinessMetricsResponse {
  mrr_usd: number | null;
  net_new_mrr_mtd_usd: number | null;
  active_paying_subs: number | null;
  churn_30d_pct: number | null;
  failed_payments_7d: number | null;
  new_paid_conversions_7d: number | null;
  pass_sales_7d: PassSalesCounts | null;
  mrr_timeseries: MrrTimeseriesPoint[] | null;
  active_subs_timeseries: ActiveSubsTimeseriesPoint[] | null;
  conversions_vs_churn_weekly: ConversionsChurnWeekPoint[] | null;
  failed_payments_weekly: FailedPaymentsWeekPoint[] | null;
  cancellation_reasons_top: CancellationReasonCount[] | null;
  cancellation_comments_recent: CancellationCommentEntry[] | null;
  emoji_feedback_ratings: EmojiFeedbackRatingCount[] | null;
  emoji_feedback_comments: EmojiFeedbackCommentEntry[] | null;
  happy_score: HappyScoreWindow[] | null;
  reengagement_reasons_top: ReEngagementReasonCount[] | null;
  reengagement_comments_recent: ReEngagementCommentEntry[] | null;
  signup_countries_90d: SignupCountryCount[] | null;
  total_users: number | null;
  signups_24h: number | null;
  signups_7d: number | null;
  as_of: string;
  cache_age_seconds: number;
  errors?: BusinessMetricError[];
}

export const BUSINESS_METRICS_CACHE_TTL_MS = 15 * 60 * 1000;
export const CANCELLATION_REASONS_LOOKBACK_DAYS = 90;
export const CANCELLATION_COMMENTS_LIMIT = 20;
export const EMOJI_FEEDBACK_LOOKBACK_DAYS = 30;
export const EMOJI_FEEDBACK_COMMENTS_LIMIT = 20;
export const REENGAGEMENT_REASONS_LOOKBACK_DAYS = 90;
export const REENGAGEMENT_COMMENTS_LIMIT = 20;
export const SIGNUP_COUNTRIES_LOOKBACK_DAYS = 90;
export const SIGNUP_COUNTRIES_LIMIT = 10;
export const SIGNUPS_24H_LOOKBACK_DAYS = 1;
export const SIGNUPS_7D_LOOKBACK_DAYS = 7;

export interface IHappyScoreAskRepository {
  countByName(name: string, since: Date): Promise<number>;
}

export interface BusinessMetricsServiceDeps {
  stripeFactory?: () => Stripe;
  cacheTtlMs?: number;
  cacheRepository?: IBusinessMetricsCacheRepository;
  cancellationRepository?: ICancellationFeedbackRepository;
  emojiFeedbackRepository?: IEmojiFeedbackRepository;
  happyScoreAskRepository?: IHappyScoreAskRepository;
  reengagementRepository?: IReEngagementFeedbackRepository;
  signupCountryRepository?: ISignupCountryRepository;
  signupCountsRepository?: IUserSignupCountsRepository;
  passSalesRepository?: IPassSalesRepository;
  subscriptionsRepository?: ISubscriptionsSourceRepository;
}

const SECONDS_PER_DAY = 24 * 60 * 60;
const STRIPE_PAGE_LIMIT = 100;
const MRR_HISTORY_DAYS = 90;
const WEEKLY_HISTORY_WEEKS = 12;
const FAILED_INVOICES_LOOKBACK_DAYS = WEEKLY_HISTORY_WEEKS * 7;

const INTERVAL_TO_MONTHLY_FACTOR: Record<string, number> = {
  month: 1,
  year: 1 / 12,
  week: 4.33,
  day: 30,
};

interface NormalizedSubscription {
  id: string;
  status: string;
  createdMs: number;
  endedAtMs: number | null;
  monthlyCents: number;
  paused: boolean;
}

interface NormalizedInvoice {
  id: string;
  status: string;
  attemptCount: number;
  createdMs: number;
}

const STRIPE_SUBS_CACHE_KEY: BusinessCacheKey = '_stripe_subs';
const STRIPE_INVOICES_CACHE_KEY: BusinessCacheKey = '_stripe_invoices';

const SUBS_DERIVED_METRICS: BusinessMetricKey[] = [
  'mrr_usd',
  'active_paying_subs',
  'net_new_mrr_mtd_usd',
  'new_paid_conversions_7d',
  'churn_30d_pct',
  'mrr_timeseries',
  'active_subs_timeseries',
  'conversions_vs_churn_weekly',
];

const INVOICES_DERIVED_METRICS: BusinessMetricKey[] = [
  'failed_payments_7d',
  'failed_payments_weekly',
];

interface SourceRefreshResult {
  subs: NormalizedSubscription[] | null;
  invoices: NormalizedInvoice[] | null;
  subsError: string | null;
  invoicesError: string | null;
}

interface ResolvedSources {
  subs: NormalizedSubscription[] | null;
  invoices: NormalizedInvoice[] | null;
  subsError: string | null;
  invoicesError: string | null;
  subsEntry: BusinessMetricsCacheEntry | null;
  invoicesEntry: BusinessMetricsCacheEntry | null;
}

export class BusinessMetricsService {
  private readonly stripeFactory: () => Stripe;

  private readonly cacheTtlMs: number;

  private readonly cacheRepository: IBusinessMetricsCacheRepository;

  private readonly cancellationRepository: ICancellationFeedbackRepository;

  private readonly emojiFeedbackRepository: IEmojiFeedbackRepository;

  private readonly happyScoreAskRepository: IHappyScoreAskRepository | null;

  private readonly reengagementRepository: IReEngagementFeedbackRepository;

  private readonly signupCountryRepository: ISignupCountryRepository | null;

  private readonly signupCountsRepository: IUserSignupCountsRepository | null;

  private readonly passSalesRepository: IPassSalesRepository | null;

  private readonly subscriptionsRepository: ISubscriptionsSourceRepository;

  private inflightSourceRefresh: Promise<SourceRefreshResult> | null = null;

  constructor(deps: BusinessMetricsServiceDeps = {}) {
    this.stripeFactory = deps.stripeFactory ?? (() => getStripe());
    this.cacheTtlMs = deps.cacheTtlMs ?? BUSINESS_METRICS_CACHE_TTL_MS;
    this.cacheRepository =
      deps.cacheRepository ?? new InMemoryBusinessMetricsCacheRepository();
    this.cancellationRepository =
      deps.cancellationRepository ??
      new InMemoryCancellationFeedbackRepository();
    this.emojiFeedbackRepository =
      deps.emojiFeedbackRepository ?? new InMemoryEmojiFeedbackRepository();
    this.happyScoreAskRepository = deps.happyScoreAskRepository ?? null;
    this.reengagementRepository =
      deps.reengagementRepository ??
      new InMemoryReEngagementFeedbackRepository();
    this.signupCountryRepository = deps.signupCountryRepository ?? null;
    this.signupCountsRepository = deps.signupCountsRepository ?? null;
    this.passSalesRepository = deps.passSalesRepository ?? null;
    this.subscriptionsRepository =
      deps.subscriptionsRepository ??
      new InMemorySubscriptionsSourceRepository();
  }

  async getMetrics(): Promise<BusinessMetricsResponse> {
    const now = new Date();
    const errors: BusinessMetricError[] = [];

    const cachedByKey = await this.loadCacheMap();

    const sources = await this.resolveSources(cachedByKey, now);

    const dbTasks = this.buildDbMetricTasks(now);
    const usedEntries: BusinessMetricsCacheEntry[] = [];
    const freshEntries: BusinessMetricsCacheEntry[] = [];

    if (sources.subsEntry != null) usedEntries.push(sources.subsEntry);
    if (sources.invoicesEntry != null) usedEntries.push(sources.invoicesEntry);

    const dbSettled = await Promise.all(
      dbTasks.map(({ key, fetch }) =>
        this.resolveMetric(
          key,
          fetch,
          now,
          cachedByKey,
          usedEntries,
          freshEntries
        ).catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          errors.push({ metric: key, message });
          return null;
        })
      )
    );

    if (freshEntries.length > 0) {
      try {
        await this.cacheRepository.upsertMany(freshEntries);
      } catch (error) {
        console.error('[ops] business metrics cache upsert failed', error);
      }
    }

    const dbValueByKey = new Map<BusinessMetricKey, unknown>();
    dbTasks.forEach(({ key }, idx) => {
      dbValueByKey.set(key, dbSettled[idx]);
    });

    const cacheAgeSeconds = computeCacheAgeSeconds(usedEntries, now);

    const subs = sources.subs;
    const invoices = sources.invoices;
    const fromSubs = <T>(fn: (s: NormalizedSubscription[]) => T): T | null =>
      subs != null ? fn(subs) : null;
    const fromInvoices = <T>(fn: (i: NormalizedInvoice[]) => T): T | null =>
      invoices != null ? fn(invoices) : null;

    const response: BusinessMetricsResponse = {
      mrr_usd: fromSubs((s) => computeMrrUsd(s, now)),
      net_new_mrr_mtd_usd: fromSubs((s) => computeNetNewMrrMtdUsd(s, now)),
      active_paying_subs: fromSubs((s) => computeActiveCount(s, now)),
      churn_30d_pct: fromSubs((s) => computeChurn30dPct(s, now)),
      failed_payments_7d: fromInvoices((i) => computeFailedPayments7d(i, now)),
      new_paid_conversions_7d: fromSubs((s) =>
        computeNewPaidConversions7d(s, now)
      ),
      pass_sales_7d: dbValueByKey.has('pass_sales_7d')
        ? (dbValueByKey.get('pass_sales_7d') as PassSalesCounts | null)
        : null,
      mrr_timeseries: fromSubs((s) => computeMrrTimeseries(s, now)),
      active_subs_timeseries: fromSubs((s) =>
        computeActiveSubsTimeseries(s, now)
      ),
      conversions_vs_churn_weekly: fromSubs((s) =>
        computeConversionsChurnWeekly(s, now)
      ),
      failed_payments_weekly: fromInvoices((i) =>
        computeFailedPaymentsWeekly(i, now)
      ),
      cancellation_reasons_top: dbValueByKey.get('cancellation_reasons_top') as
        | CancellationReasonCount[]
        | null,
      cancellation_comments_recent: dbValueByKey.get(
        'cancellation_comments_recent'
      ) as CancellationCommentEntry[] | null,
      emoji_feedback_ratings: dbValueByKey.get('emoji_feedback_ratings') as
        | EmojiFeedbackRatingCount[]
        | null,
      emoji_feedback_comments: dbValueByKey.get('emoji_feedback_comments') as
        | EmojiFeedbackCommentEntry[]
        | null,
      happy_score: dbValueByKey.get('happy_score') as HappyScoreWindow[] | null,
      reengagement_reasons_top: dbValueByKey.get('reengagement_reasons_top') as
        | ReEngagementReasonCount[]
        | null,
      reengagement_comments_recent: dbValueByKey.get(
        'reengagement_comments_recent'
      ) as ReEngagementCommentEntry[] | null,
      signup_countries_90d: dbValueByKey.has('signup_countries_90d')
        ? (dbValueByKey.get('signup_countries_90d') as
            | SignupCountryCount[]
            | null)
        : null,
      total_users: dbValueByKey.has('total_users')
        ? (dbValueByKey.get('total_users') as number | null)
        : null,
      signups_24h: dbValueByKey.has('signups_24h')
        ? (dbValueByKey.get('signups_24h') as number | null)
        : null,
      signups_7d: dbValueByKey.has('signups_7d')
        ? (dbValueByKey.get('signups_7d') as number | null)
        : null,
      as_of: now.toISOString(),
      cache_age_seconds: cacheAgeSeconds,
    };

    if (sources.subsError != null) {
      for (const key of SUBS_DERIVED_METRICS) {
        errors.push({ metric: key, message: sources.subsError });
      }
    }
    if (sources.invoicesError != null) {
      for (const key of INVOICES_DERIVED_METRICS) {
        errors.push({ metric: key, message: sources.invoicesError });
      }
    }

    if (errors.length > 0) {
      response.errors = errors;
    }

    return response;
  }

  // Test helper: lets a test await a background SWR refresh.
  // Production callers never need this; SWR is fire-and-forget by design.
  async waitForInflightRefresh(): Promise<void> {
    const inflight = this.inflightSourceRefresh;
    if (inflight != null) {
      try {
        await inflight;
      } catch {
        // background refresh errors are surfaced on the next request's error array
      }
    }
  }

  private async fetchHappyScoreWindows(now: Date): Promise<HappyScoreWindow[]> {
    return Promise.all(
      HAPPY_SCORE_WINDOWS.map(async ({ label, days }) => {
        const since = new Date(now.getTime() - days * SECONDS_PER_DAY * 1000);
        const [counts, asks] = await Promise.all([
          this.emojiFeedbackRepository.countByRating(since),
          this.happyScoreAskRepository == null
            ? Promise.resolve(null)
            : this.happyScoreAskRepository.countByName(
                HAPPY_SCORE_ASK_EVENT,
                since
              ),
        ]);
        return computeHappyScore(label, counts, asks);
      })
    );
  }

  private buildDbMetricTasks(
    now: Date
  ): Array<{ key: BusinessMetricKey; fetch: () => Promise<unknown> }> {
    const tasks: Array<{
      key: BusinessMetricKey;
      fetch: () => Promise<unknown>;
    }> = [
      {
        key: 'cancellation_reasons_top',
        fetch: () =>
          this.cancellationRepository.countByReason(
            new Date(
              now.getTime() -
                CANCELLATION_REASONS_LOOKBACK_DAYS * SECONDS_PER_DAY * 1000
            )
          ),
      },
      {
        key: 'cancellation_comments_recent',
        fetch: () =>
          this.cancellationRepository.recentComments(
            CANCELLATION_COMMENTS_LIMIT
          ),
      },
      {
        key: 'emoji_feedback_ratings',
        fetch: () =>
          this.emojiFeedbackRepository.countByRating(
            new Date(
              now.getTime() -
                EMOJI_FEEDBACK_LOOKBACK_DAYS * SECONDS_PER_DAY * 1000
            )
          ),
      },
      {
        key: 'emoji_feedback_comments',
        fetch: () =>
          this.emojiFeedbackRepository.recentComments(
            EMOJI_FEEDBACK_COMMENTS_LIMIT
          ),
      },
      {
        key: 'happy_score',
        fetch: () => this.fetchHappyScoreWindows(now),
      },
      {
        key: 'reengagement_reasons_top',
        fetch: () =>
          this.reengagementRepository.countByReason(
            new Date(
              now.getTime() -
                REENGAGEMENT_REASONS_LOOKBACK_DAYS * SECONDS_PER_DAY * 1000
            )
          ),
      },
      {
        key: 'reengagement_comments_recent',
        fetch: () =>
          this.reengagementRepository.recentComments(
            REENGAGEMENT_COMMENTS_LIMIT
          ),
      },
    ];

    if (this.passSalesRepository != null) {
      tasks.push({
        key: 'pass_sales_7d',
        fetch: () =>
          this.passSalesRepository!.passSalesSince(
            new Date(now.getTime() - 7 * SECONDS_PER_DAY * 1000)
          ),
      });
    }

    if (this.signupCountryRepository != null) {
      tasks.push({
        key: 'signup_countries_90d',
        fetch: () =>
          this.signupCountryRepository!.countBySignupCountry(
            new Date(
              now.getTime() -
                SIGNUP_COUNTRIES_LOOKBACK_DAYS * SECONDS_PER_DAY * 1000
            ),
            SIGNUP_COUNTRIES_LIMIT
          ),
      });
    }

    if (this.signupCountsRepository != null) {
      const repo = this.signupCountsRepository;
      tasks.push(
        {
          key: 'total_users',
          fetch: () => repo.countTotalUsers(),
        },
        {
          key: 'signups_24h',
          fetch: () =>
            repo.countSignupsSince(
              new Date(
                now.getTime() -
                  SIGNUPS_24H_LOOKBACK_DAYS * SECONDS_PER_DAY * 1000
              )
            ),
        },
        {
          key: 'signups_7d',
          fetch: () =>
            repo.countSignupsSince(
              new Date(
                now.getTime() -
                  SIGNUPS_7D_LOOKBACK_DAYS * SECONDS_PER_DAY * 1000
              )
            ),
        }
      );
    }

    return tasks;
  }

  private async resolveSources(
    cachedByKey: Map<BusinessCacheKey, BusinessMetricsCacheEntry>,
    now: Date
  ): Promise<ResolvedSources> {
    const cachedSubs = cachedByKey.get(STRIPE_SUBS_CACHE_KEY);
    const cachedInvoices = cachedByKey.get(STRIPE_INVOICES_CACHE_KEY);
    const subsFresh =
      cachedSubs != null && cachedSubs.expiresAt.getTime() > now.getTime();
    const invoicesFresh =
      cachedInvoices != null &&
      cachedInvoices.expiresAt.getTime() > now.getTime();

    if (subsFresh && invoicesFresh) {
      return {
        subs: cachedSubs!.value as NormalizedSubscription[],
        invoices: cachedInvoices!.value as NormalizedInvoice[],
        subsError: null,
        invoicesError: null,
        subsEntry: cachedSubs!,
        invoicesEntry: cachedInvoices!,
      };
    }

    const hasBothCached = cachedSubs != null && cachedInvoices != null;
    if (!hasBothCached) {
      const refresh = await this.startOrJoinSourceRefresh(now);
      return this.buildSourcesFromRefresh(refresh, now);
    }

    this.startOrJoinSourceRefresh(now).catch(() => undefined);
    return {
      subs: cachedSubs!.value as NormalizedSubscription[],
      invoices: cachedInvoices!.value as NormalizedInvoice[],
      subsError: null,
      invoicesError: null,
      subsEntry: cachedSubs!,
      invoicesEntry: cachedInvoices!,
    };
  }

  private buildSourcesFromRefresh(
    refresh: SourceRefreshResult,
    now: Date
  ): ResolvedSources {
    const expiresAt = new Date(now.getTime() + this.cacheTtlMs);
    return {
      subs: refresh.subs,
      invoices: refresh.invoices,
      subsError: refresh.subsError,
      invoicesError: refresh.invoicesError,
      subsEntry:
        refresh.subs != null
          ? {
              key: STRIPE_SUBS_CACHE_KEY,
              value: refresh.subs,
              cachedAt: now,
              expiresAt,
            }
          : null,
      invoicesEntry:
        refresh.invoices != null
          ? {
              key: STRIPE_INVOICES_CACHE_KEY,
              value: refresh.invoices,
              cachedAt: now,
              expiresAt,
            }
          : null,
    };
  }

  private startOrJoinSourceRefresh(now: Date): Promise<SourceRefreshResult> {
    if (this.inflightSourceRefresh != null) {
      return this.inflightSourceRefresh;
    }
    const promise = this.runSourceRefresh(now);
    this.inflightSourceRefresh = promise;
    promise
      .catch(() => undefined)
      .finally(() => {
        if (this.inflightSourceRefresh === promise) {
          this.inflightSourceRefresh = null;
        }
      });
    return promise;
  }

  private async runSourceRefresh(now: Date): Promise<SourceRefreshResult> {
    const [subsResult, invoicesResult] = await Promise.allSettled([
      this.fetchAllSubs(),
      this.fetchInvoices(now),
    ]);

    const subs = subsResult.status === 'fulfilled' ? subsResult.value : null;
    const subsError =
      subsResult.status === 'rejected' ? messageOf(subsResult.reason) : null;
    const invoices =
      invoicesResult.status === 'fulfilled' ? invoicesResult.value : null;
    const invoicesError =
      invoicesResult.status === 'rejected'
        ? messageOf(invoicesResult.reason)
        : null;

    const expiresAt = new Date(now.getTime() + this.cacheTtlMs);
    const toCache: BusinessMetricsCacheEntry[] = [];
    if (subs != null) {
      toCache.push({
        key: STRIPE_SUBS_CACHE_KEY,
        value: subs,
        cachedAt: now,
        expiresAt,
      });
    }
    if (invoices != null) {
      toCache.push({
        key: STRIPE_INVOICES_CACHE_KEY,
        value: invoices,
        cachedAt: now,
        expiresAt,
      });
    }
    if (toCache.length > 0) {
      try {
        await this.cacheRepository.upsertMany(toCache);
      } catch (error) {
        console.error('[ops] business source cache upsert failed', error);
      }
    }

    return { subs, invoices, subsError, invoicesError };
  }

  private async loadCacheMap(): Promise<
    Map<BusinessCacheKey, BusinessMetricsCacheEntry>
  > {
    const map = new Map<BusinessCacheKey, BusinessMetricsCacheEntry>();
    try {
      const rows = await this.cacheRepository.loadAll();
      for (const row of rows) {
        map.set(row.key, row);
      }
    } catch (error) {
      console.error('[ops] business metrics cache load failed', error);
    }
    return map;
  }

  private async resolveMetric(
    key: BusinessMetricKey,
    fetcher: () => Promise<unknown>,
    now: Date,
    cachedByKey: Map<BusinessCacheKey, BusinessMetricsCacheEntry>,
    usedEntries: BusinessMetricsCacheEntry[],
    freshEntries: BusinessMetricsCacheEntry[]
  ): Promise<unknown> {
    const existing = cachedByKey.get(key);
    if (existing != null && existing.expiresAt.getTime() > now.getTime()) {
      usedEntries.push(existing);
      return existing.value;
    }
    const value = await fetcher();
    const entry: BusinessMetricsCacheEntry = {
      key,
      value,
      cachedAt: now,
      expiresAt: new Date(now.getTime() + this.cacheTtlMs),
    };
    usedEntries.push(entry);
    freshEntries.push(entry);
    return value;
  }

  private async fetchAllSubs(): Promise<NormalizedSubscription[]> {
    const payloads = await this.subscriptionsRepository.listPayloads();
    const result: NormalizedSubscription[] = [];
    for (const payload of payloads) {
      const sub = parseStripeSubscription(payload);
      if (sub != null) {
        result.push(normalizeSubscription(sub));
      }
    }
    return result;
  }

  private async fetchInvoices(now: Date): Promise<NormalizedInvoice[]> {
    const stripe = this.stripeFactory();
    const since = epochSecondsDaysAgo(now, FAILED_INVOICES_LOOKBACK_DAYS);
    const result: NormalizedInvoice[] = [];
    let startingAfter: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const page: StripeTypes.ApiList<StripeTypes.Invoice> =
        await stripe.invoices.list({
          collection_method: 'charge_automatically',
          created: { gte: since },
          limit: STRIPE_PAGE_LIMIT,
          starting_after: startingAfter,
        });
      for (const invoice of page.data) {
        result.push(normalizeInvoice(invoice));
      }
      hasMore = page.has_more === true && page.data.length > 0;
      startingAfter = hasMore ? page.data[page.data.length - 1].id : undefined;
    }
    return result;
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const computeCacheAgeSeconds = (
  entries: BusinessMetricsCacheEntry[],
  now: Date
): number => {
  if (entries.length === 0) return 0;
  let oldest = now.getTime();
  for (const entry of entries) {
    const t = entry.cachedAt.getTime();
    if (t < oldest) oldest = t;
  }
  return Math.max(0, Math.floor((now.getTime() - oldest) / 1000));
};

const parseStripeSubscription = (
  payload: unknown
): StripeTypes.Subscription | null => {
  let value: unknown = payload;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value == null || typeof value !== 'object') {
    return null;
  }
  const candidate = value as {
    id?: unknown;
    status?: unknown;
    created?: unknown;
  };
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.status !== 'string' ||
    typeof candidate.created !== 'number'
  ) {
    return null;
  }
  return value as StripeTypes.Subscription;
};

const normalizeSubscription = (
  sub: StripeTypes.Subscription
): NormalizedSubscription => {
  const canceledAt = sub.canceled_at ?? null;
  const endedAt = sub.ended_at ?? null;
  const effectiveEnd = endedAt ?? canceledAt;
  return {
    id: sub.id,
    status: sub.status,
    createdMs: sub.created * 1000,
    endedAtMs: effectiveEnd != null ? effectiveEnd * 1000 : null,
    monthlyCents: monthlyCentsForSubscription(sub),
    paused: isPaused(sub),
  };
};

const normalizeInvoice = (invoice: StripeTypes.Invoice): NormalizedInvoice => ({
  id: invoice.id ?? '',
  status: invoice.status ?? '',
  attemptCount: invoice.attempt_count ?? 0,
  createdMs: invoice.created != null ? invoice.created * 1000 : 0,
});

const isPayingHistorical = (status: string): boolean => status !== 'trialing';

const isActiveNow = (status: string): boolean =>
  status === 'active' || status === 'past_due' || status === 'unpaid';

const isActiveToday = (sub: NormalizedSubscription, nowMs: number): boolean => {
  if (sub.createdMs > nowMs) return false;
  if (sub.endedAtMs != null && sub.endedAtMs <= nowMs) return false;
  if (sub.paused) return false;
  return isActiveNow(sub.status);
};

const wasActiveOn = (sub: NormalizedSubscription, atMs: number): boolean => {
  if (sub.createdMs > atMs) return false;
  if (sub.endedAtMs != null && sub.endedAtMs <= atMs) return false;
  if (sub.paused) return false;
  return isPayingHistorical(sub.status);
};

const computeMrrUsd = (subs: NormalizedSubscription[], now: Date): number => {
  let cents = 0;
  for (const sub of subs) {
    if (isActiveToday(sub, now.getTime())) {
      cents += sub.monthlyCents;
    }
  }
  return cents / 100;
};

const computeActiveCount = (
  subs: NormalizedSubscription[],
  now: Date
): number => {
  let count = 0;
  for (const sub of subs) {
    if (isActiveToday(sub, now.getTime())) {
      count += 1;
    }
  }
  return count;
};

const computeNetNewMrrMtdUsd = (
  subs: NormalizedSubscription[],
  now: Date
): number => {
  const startMs = startOfMonthUtcMs(now);
  let cents = 0;
  for (const sub of subs) {
    if (sub.createdMs >= startMs && isPayingHistorical(sub.status)) {
      cents += sub.monthlyCents;
    }
  }
  return cents / 100;
};

const computeNewPaidConversions7d = (
  subs: NormalizedSubscription[],
  now: Date
): number => {
  const sinceMs = now.getTime() - 7 * SECONDS_PER_DAY * 1000;
  let count = 0;
  for (const sub of subs) {
    if (sub.createdMs >= sinceMs && isPayingHistorical(sub.status)) {
      count += 1;
    }
  }
  return count;
};

const computeChurn30dPct = (
  subs: NormalizedSubscription[],
  now: Date
): number => {
  const sinceMs = now.getTime() - 30 * SECONDS_PER_DAY * 1000;
  let canceled = 0;
  let active = 0;
  for (const sub of subs) {
    if (sub.endedAtMs != null && sub.endedAtMs >= sinceMs) {
      canceled += 1;
    }
    if (isActiveToday(sub, now.getTime())) {
      active += 1;
    }
  }
  if (active === 0) return 0;
  return (canceled / active) * 100;
};

const computeFailedPayments7d = (
  invoices: NormalizedInvoice[],
  now: Date
): number => {
  const sinceMs = now.getTime() - 7 * SECONDS_PER_DAY * 1000;
  let count = 0;
  for (const invoice of invoices) {
    if (
      invoice.createdMs >= sinceMs &&
      invoice.status === 'open' &&
      invoice.attemptCount > 0
    ) {
      count += 1;
    }
  }
  return count;
};

const computeMrrTimeseries = (
  subs: NormalizedSubscription[],
  now: Date
): MrrTimeseriesPoint[] => {
  const days = lastNDayBucketsUtc(now, MRR_HISTORY_DAYS);
  return days.map((dayMs) => {
    let cents = 0;
    for (const sub of subs) {
      if (wasActiveOn(sub, dayMs)) {
        cents += sub.monthlyCents;
      }
    }
    return { t: isoDate(dayMs), mrr_usd: cents / 100 };
  });
};

const computeActiveSubsTimeseries = (
  subs: NormalizedSubscription[],
  now: Date
): ActiveSubsTimeseriesPoint[] => {
  const days = lastNDayBucketsUtc(now, MRR_HISTORY_DAYS);
  return days.map((dayMs) => {
    let count = 0;
    for (const sub of subs) {
      if (wasActiveOn(sub, dayMs)) {
        count += 1;
      }
    }
    return { t: isoDate(dayMs), active_paying_subs: count };
  });
};

const computeConversionsChurnWeekly = (
  subs: NormalizedSubscription[],
  now: Date
): ConversionsChurnWeekPoint[] => {
  const weekStarts = lastNIsoWeekStartsUtc(now, WEEKLY_HISTORY_WEEKS);
  const weekIndex = new Map<number, ConversionsChurnWeekPoint>();
  for (const startMs of weekStarts) {
    weekIndex.set(startMs, {
      week: isoDate(startMs),
      new_paying: 0,
      churned: 0,
    });
  }
  const earliestStart = weekStarts[0];
  const lastStart = weekStarts[weekStarts.length - 1];
  const weekEnd = lastStart + 7 * SECONDS_PER_DAY * 1000;

  for (const sub of subs) {
    if (
      sub.createdMs >= earliestStart &&
      sub.createdMs < weekEnd &&
      isPayingHistorical(sub.status)
    ) {
      const bucket = isoWeekStartUtcMs(sub.createdMs);
      const row = weekIndex.get(bucket);
      if (row != null) row.new_paying += 1;
    }
    if (
      sub.endedAtMs != null &&
      sub.endedAtMs >= earliestStart &&
      sub.endedAtMs < weekEnd
    ) {
      const bucket = isoWeekStartUtcMs(sub.endedAtMs);
      const row = weekIndex.get(bucket);
      if (row != null) row.churned += 1;
    }
  }

  return weekStarts.map(
    (startMs) => weekIndex.get(startMs) as ConversionsChurnWeekPoint
  );
};

const computeFailedPaymentsWeekly = (
  invoices: NormalizedInvoice[],
  now: Date
): FailedPaymentsWeekPoint[] => {
  const weekStarts = lastNIsoWeekStartsUtc(now, WEEKLY_HISTORY_WEEKS);
  const weekIndex = new Map<number, FailedPaymentsWeekPoint>();
  for (const startMs of weekStarts) {
    weekIndex.set(startMs, { week: isoDate(startMs), count: 0 });
  }
  const earliestStart = weekStarts[0];
  const lastStart = weekStarts[weekStarts.length - 1];
  const weekEnd = lastStart + 7 * SECONDS_PER_DAY * 1000;

  for (const invoice of invoices) {
    if (
      invoice.status === 'open' &&
      invoice.attemptCount > 0 &&
      invoice.createdMs >= earliestStart &&
      invoice.createdMs < weekEnd
    ) {
      const bucket = isoWeekStartUtcMs(invoice.createdMs);
      const row = weekIndex.get(bucket);
      if (row != null) row.count += 1;
    }
  }

  return weekStarts.map(
    (startMs) => weekIndex.get(startMs) as FailedPaymentsWeekPoint
  );
};

const monthlyCentsForSubscription = (
  subscription: StripeTypes.Subscription
): number => {
  const items = subscription.items?.data ?? [];
  let total = 0;
  for (const item of items) {
    const price = item.price;
    const recurring = price?.recurring;
    if (recurring == null) {
      continue;
    }
    const unitAmount = price?.unit_amount;
    if (unitAmount == null) {
      continue;
    }
    const quantity = item.quantity ?? 1;
    const intervalCount = recurring.interval_count ?? 1;
    const factor = INTERVAL_TO_MONTHLY_FACTOR[recurring.interval];
    if (factor == null) {
      continue;
    }
    total += (unitAmount * quantity * factor) / intervalCount;
  }
  return total;
};

const startOfMonthUtcMs = (now: Date): number =>
  Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);

const epochSecondsDaysAgo = (now: Date, days: number): number =>
  Math.floor(now.getTime() / 1000) - days * SECONDS_PER_DAY;

const startOfDayUtcMs = (atMs: number): number => {
  const d = new Date(atMs);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    0,
    0,
    0,
    0
  );
};

const lastNDayBucketsUtc = (now: Date, n: number): number[] => {
  const todayStart = startOfDayUtcMs(now.getTime());
  const result: number[] = [];
  for (let offset = n - 1; offset >= 0; offset -= 1) {
    result.push(todayStart - offset * SECONDS_PER_DAY * 1000);
  }
  return result;
};

const isoDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const isoWeekStartUtcMs = (atMs: number): number => {
  const dayStart = startOfDayUtcMs(atMs);
  const dow = new Date(dayStart).getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  return dayStart - daysSinceMonday * SECONDS_PER_DAY * 1000;
};

const lastNIsoWeekStartsUtc = (now: Date, n: number): number[] => {
  const currentWeekStart = isoWeekStartUtcMs(now.getTime());
  const result: number[] = [];
  for (let offset = n - 1; offset >= 0; offset -= 1) {
    result.push(currentWeekStart - offset * 7 * SECONDS_PER_DAY * 1000);
  }
  return result;
};

export default BusinessMetricsService;
