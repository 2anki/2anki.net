import {
  CURRENT_SCORER_VERSION,
  type IConversionRuleScoresRepository,
} from '../../data_layer/ConversionRuleScoresRepository';
import type {
  ConversionOutcomeCounts,
  IEventsMetricsRepository,
  NewAccountDownloadCounts,
} from '../../data_layer/EventsMetricsRepository';
import type { IJobsMetricsRepository } from '../../data_layer/JobsMetricsRepository';
import { ACCOUNT_CREATED_RELIABLE_SINCE } from './UploadFunnelService';

export type ConversionMetricKey =
  | 'free_conversions_7d'
  | 'paid_conversions_7d'
  | 'free_conversion_success_rate_7d'
  | 'paid_conversion_success_rate_7d'
  | 'free_blocked_by_plan_7d'
  | 'paid_blocked_by_plan_7d'
  | 'conversion_errors_7d_top_reasons'
  | 'failed_conversions_weekly'
  | 'new_accounts_downloaded_24h_rate_30d'
  | 'new_accounts_downloaded_after_signup_24h_rate_30d'
  | 'upload_to_download_rate_7d';

export interface ConversionErrorCount {
  reason: string;
  count: number;
}

export interface FailedConversionsWeekPoint {
  week: string;
  count: number;
}

export interface DeckQualityCohort {
  engine: string;
  input_format: string;
  sample_size: number;
  no_cards_count: number;
  no_cards_rate: number | null;
  enough_data: boolean;
  composite_p10: number | null;
  composite_p50: number | null;
  composite_p90: number | null;
  card_count_p50: number | null;
  median_back_len_p50: number | null;
  blank_back_rate_p90: number | null;
}

export interface ConversionMetricsResponse {
  free_conversions_7d: number | null;
  paid_conversions_7d: number | null;
  free_conversion_success_rate_7d: number | null;
  paid_conversion_success_rate_7d: number | null;
  free_blocked_by_plan_7d: number | null;
  paid_blocked_by_plan_7d: number | null;
  conversion_errors_7d_top_reasons: ConversionErrorCount[] | null;
  failed_conversions_weekly: FailedConversionsWeekPoint[] | null;
  new_accounts_downloaded_24h_rate_30d: number | null;
  new_accounts_downloaded_after_signup_24h_rate_30d: number | null;
  upload_to_download_rate_7d: number | null;
  deck_quality_cohorts_30d: DeckQualityCohort[] | null;
}

const SECONDS_PER_DAY = 24 * 60 * 60;
const WEEKLY_HISTORY_WEEKS = 12;
const COHORT_WINDOW_DAYS = 30;

// A cohort below this many conversions is noise, not a distribution. Reported
// with its sample size and no percentiles rather than dropped, so a format that
// is failing but rare stays visible instead of silently vanishing.
export const MIN_COHORT_SAMPLE = 30;

function fromOutcomes<T>(
  settled: PromiseSettledResult<ConversionOutcomeCounts>,
  pick: (counts: ConversionOutcomeCounts) => T
): T | null {
  return settled.status === 'fulfilled' ? pick(settled.value) : null;
}

function successRate({
  succeeded,
  technicalFailed,
}: ConversionOutcomeCounts): number | null {
  const attempts = succeeded + technicalFailed;
  return attempts === 0 ? null : (succeeded / attempts) * 100;
}

const MS_PER_DAY = SECONDS_PER_DAY * 1000;

function shareOfNewAccounts(
  settled: PromiseSettledResult<NewAccountDownloadCounts | null>,
  pick: (counts: NewAccountDownloadCounts) => number
): number | null {
  if (settled.status !== 'fulfilled' || settled.value == null) return null;
  const { accounts } = settled.value;
  return accounts === 0 ? null : (pick(settled.value) / accounts) * 100;
}

export class ConversionMetricsService {
  constructor(
    private readonly repository: IJobsMetricsRepository,
    private readonly eventsMetricsRepository: IEventsMetricsRepository,
    private readonly scoresRepository?: IConversionRuleScoresRepository
  ) {}

  private async deckQualityCohorts(
    since: Date
  ): Promise<DeckQualityCohort[] | null> {
    if (this.scoresRepository == null) return null;
    const rows = await this.scoresRepository.distribution({
      since,
      scorerVersion: CURRENT_SCORER_VERSION,
    });
    return rows.map((row) => {
      const enough = row.sampleSize >= MIN_COHORT_SAMPLE;
      return {
        engine: row.engine,
        input_format: row.inputFormat,
        sample_size: row.sampleSize,
        no_cards_count: row.noCardsCount,
        no_cards_rate:
          row.sampleSize + row.noCardsCount === 0
            ? null
            : row.noCardsCount / (row.sampleSize + row.noCardsCount),
        enough_data: enough,
        composite_p10: enough ? row.compositeP10 : null,
        composite_p50: enough ? row.compositeP50 : null,
        composite_p90: enough ? row.compositeP90 : null,
        card_count_p50: enough ? row.cardCountP50 : null,
        median_back_len_p50: enough ? row.medianBackLenP50 : null,
        blank_back_rate_p90: enough ? row.blankBackRateP90 : null,
      };
    });
  }

  private newAccountDownloads(
    now: Date,
    thirtyDaysAgo: Date
  ): Promise<NewAccountDownloadCounts | null> {
    const cohortStart = new Date(
      Math.max(
        thirtyDaysAgo.getTime(),
        ACCOUNT_CREATED_RELIABLE_SINCE.getTime()
      )
    );
    const cohortEnd = new Date(now.getTime() - MS_PER_DAY);
    if (cohortStart >= cohortEnd) return Promise.resolve(null);
    return this.eventsMetricsRepository.newAccountDownloads(
      cohortStart,
      cohortEnd
    );
  }

  async getMetrics(): Promise<ConversionMetricsResponse> {
    const now = new Date();
    const sevenDaysAgoMs = now.getTime() - 7 * SECONDS_PER_DAY * 1000;
    const sevenDaysAgo = new Date(sevenDaysAgoMs);
    const thirtyDaysAgo = new Date(
      now.getTime() - COHORT_WINDOW_DAYS * SECONDS_PER_DAY * 1000
    );

    const weekStarts = this.lastNIsoWeekStartsUtc(now, WEEKLY_HISTORY_WEEKS);
    const earliestStart = new Date(weekStarts[0]);
    const lastStart = weekStarts[weekStarts.length - 1];
    const weekEnd = new Date(lastStart + 7 * SECONDS_PER_DAY * 1000);

    const [
      freeOutcomes,
      paidOutcomes,
      topErrors7d,
      failedConversionsWeeklyRows,
      newAccountDownloads30d,
      uploadToDownloadRate7d,
      deckQualityCohorts30d,
    ] = await Promise.allSettled([
      this.eventsMetricsRepository.conversionOutcomes(sevenDaysAgo, 'free'),
      this.eventsMetricsRepository.conversionOutcomes(sevenDaysAgo, 'paid'),
      this.repository.topFailureReasons7d(sevenDaysAgo),
      this.repository.failedConversionsWeekly(earliestStart, weekEnd),
      this.newAccountDownloads(now, thirtyDaysAgo),
      this.eventsMetricsRepository.uploadToDownloadRate(sevenDaysAgo),
      this.deckQualityCohorts(thirtyDaysAgo),
    ]);

    const failedConversionsWeekly =
      failedConversionsWeeklyRows.status === 'fulfilled'
        ? this.buildWeeklyTimeSeries(
            weekStarts,
            failedConversionsWeeklyRows.value
          )
        : null;

    return {
      free_conversions_7d: fromOutcomes(freeOutcomes, (o) => o.succeeded),
      paid_conversions_7d: fromOutcomes(paidOutcomes, (o) => o.succeeded),
      free_conversion_success_rate_7d: fromOutcomes(freeOutcomes, successRate),
      paid_conversion_success_rate_7d: fromOutcomes(paidOutcomes, successRate),
      free_blocked_by_plan_7d: fromOutcomes(freeOutcomes, (o) => o.planBlocked),
      paid_blocked_by_plan_7d: fromOutcomes(paidOutcomes, (o) => o.planBlocked),
      conversion_errors_7d_top_reasons:
        topErrors7d.status === 'fulfilled' ? topErrors7d.value : null,
      failed_conversions_weekly: failedConversionsWeekly,
      new_accounts_downloaded_24h_rate_30d: shareOfNewAccounts(
        newAccountDownloads30d,
        (counts) => counts.downloadedWithin24h
      ),
      new_accounts_downloaded_after_signup_24h_rate_30d: shareOfNewAccounts(
        newAccountDownloads30d,
        (counts) => counts.downloadedAfterSignup
      ),
      upload_to_download_rate_7d:
        uploadToDownloadRate7d.status === 'fulfilled'
          ? uploadToDownloadRate7d.value
          : null,
      deck_quality_cohorts_30d:
        deckQualityCohorts30d.status === 'fulfilled'
          ? deckQualityCohorts30d.value
          : null,
    };
  }

  private buildWeeklyTimeSeries(
    weekStarts: number[],
    rows: Array<{ weekStart: Date; count: number }>
  ): FailedConversionsWeekPoint[] {
    const weekIndex = new Map<number, FailedConversionsWeekPoint>();

    for (const startMs of weekStarts) {
      weekIndex.set(startMs, {
        week: this.isoDate(startMs),
        count: 0,
      });
    }

    for (const row of rows) {
      const bucket = this.isoWeekStartUtcMs(row.weekStart.getTime());
      const existing = weekIndex.get(bucket);
      if (existing) {
        existing.count = row.count;
      }
    }

    return weekStarts.map(
      (startMs) => weekIndex.get(startMs) as FailedConversionsWeekPoint
    );
  }

  private isoDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  private isoWeekStartUtcMs(atMs: number): number {
    const dayStart = this.startOfDayUtcMs(atMs);
    const dow = new Date(dayStart).getUTCDay();
    const daysSinceMonday = (dow + 6) % 7;
    return dayStart - daysSinceMonday * SECONDS_PER_DAY * 1000;
  }

  private startOfDayUtcMs(atMs: number): number {
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
  }

  private lastNIsoWeekStartsUtc(now: Date, n: number): number[] {
    const currentWeekStart = this.isoWeekStartUtcMs(now.getTime());
    const result: number[] = [];
    for (let offset = n - 1; offset >= 0; offset -= 1) {
      result.push(currentWeekStart - offset * 7 * SECONDS_PER_DAY * 1000);
    }
    return result;
  }
}
