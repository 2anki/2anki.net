import {
  BusinessMetricsCacheEntry,
  IBusinessMetricsCacheRepository,
} from '../../data_layer/BusinessMetricsCacheRepository';
import { BusinessMetricsResponse } from './BusinessMetricsService';
import { ConversionMetricsResponse } from './ConversionMetricsService';
import { PaidValueMonitorResponse } from './PaidValueMonitorService';
import { PassUnlockMonitorResponse } from './PassUnlockMonitorService';
import {
  FAILED_PAYMENTS_SPIKE_MULTIPLIER,
  MONITOR_WINDOW_DAYS,
  RED_MISS_RATIO,
  TODAY_SNAPSHOT_TTL_MS,
  TODAY_TARGETS,
  TodayTarget,
} from './todayThresholds';

export type ScoreStatus = 'red' | 'amber' | 'green' | 'none';
export type ScoreLever = 'acquisition' | 'revenue' | 'retention' | 'health';
export type ScoreFormat = 'count' | 'percent';
export type TargetDirection = 'at_least' | 'at_most';

export interface ScoreRow {
  id: string;
  lever: ScoreLever;
  label: string;
  format: ScoreFormat;
  window_label: string;
  value: number | null;
  delta: number | null;
  delta_good: boolean | null;
  target: number | null;
  target_direction: TargetDirection | null;
  status: ScoreStatus;
  link: string;
}

export interface TodaySnapshotError {
  source: string;
  message: string;
}

export interface TodaySnapshotResponse {
  rows: ScoreRow[];
  as_of: string;
  cache_age_seconds: number;
  stale: boolean;
  errors: TodaySnapshotError[];
}

export interface TodaySnapshotInputs {
  business: BusinessMetricsResponse | null;
  conversion: ConversionMetricsResponse | null;
  unresolvedErrorGroups: number | null;
  passUnlock: PassUnlockMonitorResponse | null;
  paidValue: PaidValueMonitorResponse | null;
}

export interface TodaySnapshotSources {
  business: () => Promise<BusinessMetricsResponse>;
  conversion: () => Promise<ConversionMetricsResponse>;
  unresolvedErrorGroups: () => Promise<number>;
  passUnlock: (since: Date, now: Date) => Promise<PassUnlockMonitorResponse>;
  paidValue: (since: Date, now: Date) => Promise<PaidValueMonitorResponse>;
}

export const TODAY_SNAPSHOT_CACHE_KEY = '_today_snapshot';

const STATUS_ORDER: Record<ScoreStatus, number> = {
  red: 0,
  amber: 1,
  green: 2,
  none: 3,
};

const DAY_MS = 24 * 60 * 60 * 1000;

const mean = (values: number[]): number =>
  values.reduce((sum, n) => sum + n, 0) / values.length;

const lowestPresent = (...values: Array<number | null>): number | null => {
  const present = values.filter((n): n is number => n != null);
  return present.length === 0 ? null : Math.min(...present);
};

export function evaluateStatus(
  value: number | null,
  target: TodayTarget | null
): ScoreStatus {
  if (value == null || target == null) return 'none';
  const missedSeverity = target.missedSeverity ?? 'red';
  if (target.at_least != null) {
    if (value >= target.at_least) return 'green';
    const missRatio = (target.at_least - value) / target.at_least;
    return missRatio > RED_MISS_RATIO ? 'red' : 'amber';
  }
  if (target.at_most != null) {
    if (value <= target.at_most) return 'green';
    if (target.at_most === 0) return missedSeverity;
    const missRatio = (value - target.at_most) / target.at_most;
    return missRatio > RED_MISS_RATIO ? 'red' : 'amber';
  }
  return 'none';
}

const directionOf = (target: TodayTarget | null): TargetDirection | null => {
  if (target?.at_least != null) return 'at_least';
  if (target?.at_most != null) return 'at_most';
  return null;
};

const targetValueOf = (target: TodayTarget | null): number | null =>
  target?.at_least ?? target?.at_most ?? null;

const deltaGood = (
  delta: number | null,
  direction: TargetDirection | null
): boolean | null => {
  if (delta == null || direction == null || delta === 0) return null;
  return direction === 'at_least' ? delta > 0 : delta < 0;
};

interface RowSpec {
  id: string;
  lever: ScoreLever;
  label: string;
  format: ScoreFormat;
  window_label: string;
  value: number | null;
  prior?: number | null;
  target: TodayTarget | null;
  link: string;
}

const buildRow = (spec: RowSpec): ScoreRow => {
  const direction = directionOf(spec.target);
  const delta =
    spec.value != null && spec.prior != null ? spec.value - spec.prior : null;
  return {
    id: spec.id,
    lever: spec.lever,
    label: spec.label,
    format: spec.format,
    window_label: spec.window_label,
    value: spec.value,
    delta,
    delta_good: deltaGood(delta, direction),
    target: targetValueOf(spec.target),
    target_direction: direction,
    status: evaluateStatus(spec.value, spec.target),
    link: spec.link,
  };
};

const failedPaymentsSpec = (
  business: BusinessMetricsResponse | null
): RowSpec => {
  const weekly = business?.failed_payments_weekly ?? null;
  const latestPoint =
    weekly != null && weekly.length > 0 ? weekly[weekly.length - 1] : undefined;
  const latest = latestPoint?.count ?? null;
  const priorWeeks = weekly != null ? weekly.slice(0, -1) : [];
  const priorAvg =
    priorWeeks.length > 0 ? mean(priorWeeks.map((w) => w.count)) : null;
  const target =
    priorAvg != null && priorAvg > 0
      ? { at_most: FAILED_PAYMENTS_SPIKE_MULTIPLIER * priorAvg }
      : null;
  return {
    id: 'failed_payments_week',
    lever: 'revenue',
    label: 'Failed payments',
    format: 'count',
    window_label: 'wk',
    value: latest,
    prior: priorAvg,
    target,
    link: '/ops/business#revenue',
  };
};

const sumPassSales = (
  sales: BusinessMetricsResponse['pass_sales_7d']
): number | null =>
  sales == null
    ? null
    : sales.day_passes + sales.week_passes + (sales.semester_passes ?? 0);

const zeroValuePaid = (
  paidValue: PaidValueMonitorResponse | null
): number | null => {
  if (paidValue == null) return null;
  const groups = [
    paidValue.passes,
    paidValue.claimedAnonymousPasses,
    paidValue.newSubscriptions,
  ];
  return groups.reduce(
    (sum, g) => sum + g.zeroValueTried + g.zeroValueNeverTried,
    0
  );
};

export function buildScoreRows(inputs: TodaySnapshotInputs): ScoreRow[] {
  const { business, conversion } = inputs;
  const specs: RowSpec[] = [
    {
      id: 'signups_7d',
      lever: 'acquisition',
      label: 'New signups',
      format: 'count',
      window_label: '7d',
      value: business?.signups_7d ?? null,
      target: TODAY_TARGETS.signups_7d,
      link: '/ops/growth#landing-page-yield',
    },
    {
      id: 'upload_to_download_7d',
      lever: 'acquisition',
      label: 'Upload → download',
      format: 'percent',
      window_label: '7d',
      value: conversion?.upload_to_download_rate_7d ?? null,
      target: null,
      link: '/ops/growth#upload-funnel',
    },
    {
      id: 'new_paid_7d',
      lever: 'revenue',
      label: 'New paid',
      format: 'count',
      window_label: '7d',
      value: business?.new_paid_conversions_7d ?? null,
      target: TODAY_TARGETS.new_paid_7d,
      link: '/ops/business#revenue',
    },
    {
      id: 'pass_sales_7d',
      lever: 'revenue',
      label: 'Pass sales',
      format: 'count',
      window_label: '7d',
      value: sumPassSales(business?.pass_sales_7d ?? null),
      target: TODAY_TARGETS.pass_sales_7d,
      link: '/ops/business#revenue',
    },
    failedPaymentsSpec(business),
    {
      id: 'churn_30d_pct',
      lever: 'retention',
      label: 'Churn',
      format: 'percent',
      window_label: '30d',
      value: business?.churn_30d_pct ?? null,
      target: TODAY_TARGETS.churn_30d_pct,
      link: '/ops/business#cancellations',
    },
    {
      id: 'conversion_success_7d_pct',
      lever: 'health',
      label: 'Conversion success',
      format: 'percent',
      window_label: '7d',
      value: lowestPresent(
        conversion?.free_conversion_success_rate_7d ?? null,
        conversion?.paid_conversion_success_rate_7d ?? null
      ),
      target: TODAY_TARGETS.conversion_success_7d_pct,
      link: '/ops/growth#conversions',
    },
    {
      id: 'happy_score_90d_pct',
      lever: 'health',
      label: 'Happy score (users who rated a finished deck)',
      format: 'percent',
      window_label: '90d',
      value:
        business?.happy_score?.find((w) => w.window === '90d')?.score_pct ??
        null,
      target: TODAY_TARGETS.happy_score_90d_pct,
      link: '/ops/business#happy-score',
    },
    {
      id: 'unresolved_error_groups',
      lever: 'health',
      label: 'Unresolved error groups',
      format: 'count',
      window_label: 'now',
      value: inputs.unresolvedErrorGroups,
      target: TODAY_TARGETS.unresolved_error_groups,
      link: '/ops/errors',
    },
    {
      id: 'missing_pass_unlocks_7d',
      lever: 'revenue',
      label: 'Paid passes not unlocked',
      format: 'count',
      window_label: '7d',
      value: inputs.passUnlock?.missing ?? null,
      target: TODAY_TARGETS.missing_pass_unlocks_7d,
      link: '/ops/business#pass-unlocks',
    },
    {
      id: 'zero_value_paid_7d',
      lever: 'retention',
      label: 'Paid users with no deck yet',
      format: 'count',
      window_label: '7d',
      value: zeroValuePaid(inputs.paidValue),
      target: TODAY_TARGETS.zero_value_paid_7d,
      link: '/ops/business#paid-value',
    },
  ];
  return specs
    .map(buildRow)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

const messageOf = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

export class TodaySnapshotService {
  constructor(
    private readonly sources: TodaySnapshotSources,
    private readonly cache: IBusinessMetricsCacheRepository,
    private readonly ttlMs: number = TODAY_SNAPSHOT_TTL_MS,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async getSnapshot(): Promise<TodaySnapshotResponse> {
    const now = this.clock();
    const cached = await this.loadCached();
    if (cached != null && cached.expiresAt.getTime() > now.getTime()) {
      return this.fromEntry(cached, now, false);
    }
    try {
      const fresh = await this.compute(now);
      const entry: BusinessMetricsCacheEntry = {
        key: TODAY_SNAPSHOT_CACHE_KEY,
        value: fresh,
        cachedAt: now,
        expiresAt: new Date(now.getTime() + this.ttlMs),
      };
      try {
        await this.cache.upsertMany([entry]);
      } catch (error) {
        console.error('[ops] today snapshot cache upsert failed', error);
      }
      return fresh;
    } catch (error) {
      if (cached != null) {
        return this.fromEntry(cached, now, true);
      }
      throw error;
    }
  }

  private async loadCached(): Promise<BusinessMetricsCacheEntry | null> {
    try {
      return await this.cache.load(TODAY_SNAPSHOT_CACHE_KEY);
    } catch (error) {
      console.error('[ops] today snapshot cache load failed', error);
      return null;
    }
  }

  private fromEntry(
    entry: BusinessMetricsCacheEntry,
    now: Date,
    stale: boolean
  ): TodaySnapshotResponse {
    const snapshot = entry.value as TodaySnapshotResponse;
    return {
      ...snapshot,
      cache_age_seconds: Math.max(
        0,
        Math.round((now.getTime() - entry.cachedAt.getTime()) / 1000)
      ),
      stale,
    };
  }

  private async compute(now: Date): Promise<TodaySnapshotResponse> {
    const since = new Date(now.getTime() - MONITOR_WINDOW_DAYS * DAY_MS);
    const errors: TodaySnapshotError[] = [];
    const settle = async <T>(
      source: string,
      task: () => Promise<T>
    ): Promise<T | null> => {
      try {
        return await task();
      } catch (error) {
        errors.push({ source, message: messageOf(error) });
        return null;
      }
    };

    const [business, conversion, unresolvedErrorGroups, passUnlock, paidValue] =
      await Promise.all([
        settle('business', () => this.sources.business()),
        settle('conversion', () => this.sources.conversion()),
        settle('errors', () => this.sources.unresolvedErrorGroups()),
        settle('pass_unlock', () => this.sources.passUnlock(since, now)),
        settle('paid_value', () => this.sources.paidValue(since, now)),
      ]);

    if (
      business == null &&
      conversion == null &&
      unresolvedErrorGroups == null &&
      passUnlock == null &&
      paidValue == null
    ) {
      throw new Error(
        `every today-snapshot source failed: ${errors
          .map((e) => `${e.source}: ${e.message}`)
          .join('; ')}`
      );
    }

    return {
      rows: buildScoreRows({
        business,
        conversion,
        unresolvedErrorGroups,
        passUnlock,
        paidValue,
      }),
      as_of: now.toISOString(),
      cache_age_seconds: 0,
      stale: false,
      errors,
    };
  }
}

export default TodaySnapshotService;
