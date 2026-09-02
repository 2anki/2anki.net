import type { Knex } from 'knex';

export interface IEventsMetricsRepository {
  medianMinutesToFirstDeck(cohortStart: Date): Promise<number | null>;
  uploadToDownloadRate(since: Date): Promise<number | null>;
}

export interface PassSalesCounts {
  day_passes: number;
  week_passes: number;
  semester_passes: number;
}

export interface IPassSalesRepository {
  passSalesSince(since: Date): Promise<PassSalesCounts>;
}

export const PAID_VALUE_EVENT_NAMES = [
  'conversion_succeeded',
  'deck_downloaded',
  'conversion_failed',
] as const;

export interface PaidValueEventRow {
  userId: number;
  name: string;
  createdAt: Date;
}

export interface MedianMinutesRow {
  median_minutes: number | string | null;
}

export interface UploadToDownloadRateRow {
  uploaders: number | string;
  downloaders: number | string;
}

export function mapMedianMinutesRow(
  row: MedianMinutesRow | undefined
): number | null {
  if (row?.median_minutes == null) return null;
  return Number(row.median_minutes);
}

export function mapUploadToDownloadRateRow(
  row: UploadToDownloadRateRow | undefined
): number | null {
  if (row == null || Number(row.uploaders) === 0) return null;
  return (Number(row.downloaders) / Number(row.uploaders)) * 100;
}

export class EventsMetricsRepository
  implements IEventsMetricsRepository, IPassSalesRepository
{
  constructor(private readonly database: Knex) {}

  buildPassSalesQuery(since: Date): Knex.QueryBuilder {
    return this.database('events')
      .select(this.database.raw("props->>'plan' as plan"))
      .count('* as count')
      .where('name', 'checkout_completed')
      .where('created_at', '>=', since)
      .whereRaw("props->>'plan' in ('24h', '7d', '120d')")
      .groupBy('plan');
  }

  async passSalesSince(since: Date): Promise<PassSalesCounts> {
    const rows = (await this.buildPassSalesQuery(since)) as Array<{
      plan: string;
      count: string | number;
    }>;
    const byPlan = new Map(rows.map((r) => [r.plan, Number(r.count)]));
    return {
      day_passes: byPlan.get('24h') ?? 0,
      week_passes: byPlan.get('7d') ?? 0,
      semester_passes: byPlan.get('120d') ?? 0,
    };
  }

  buildMedianMinutesToFirstDeckQuery(cohortStart: Date): Knex.QueryBuilder {
    const accounts = this.database('events')
      .select('user_id')
      .min('created_at as account_at')
      .where('name', 'account_created')
      .where('created_at', '>=', cohortStart)
      .whereNotNull('user_id')
      .groupBy('user_id')
      .as('accounts');

    const downloads = this.database('events')
      .select('user_id')
      .min('created_at as first_download_at')
      .where('name', 'deck_downloaded')
      .whereNotNull('user_id')
      .groupBy('user_id')
      .as('downloads');

    return this.database
      .from(accounts)
      .join(downloads, 'downloads.user_id', 'accounts.user_id')
      .whereRaw('downloads.first_download_at >= accounts.account_at')
      .select(
        this.database.raw(
          'percentile_cont(0.5) within group (order by extract(epoch from (downloads.first_download_at - accounts.account_at)) / 60) as median_minutes'
        )
      );
  }

  async medianMinutesToFirstDeck(cohortStart: Date): Promise<number | null> {
    const row = (await this.buildMedianMinutesToFirstDeckQuery(
      cohortStart
    ).first()) as MedianMinutesRow | undefined;
    return mapMedianMinutesRow(row);
  }

  buildUploadToDownloadRateQuery(since: Date): Knex.QueryBuilder {
    return this.database('events')
      .where('created_at', '>=', since)
      .whereIn('name', ['upload_started', 'deck_downloaded'])
      .select(
        this.database.raw(
          'count(distinct case when name = ? then COALESCE(user_id::text, anonymous_id) end) as uploaders',
          ['upload_started']
        ),
        this.database.raw(
          'count(distinct case when name = ? then COALESCE(user_id::text, anonymous_id) end) as downloaders',
          ['deck_downloaded']
        )
      );
  }

  async uploadToDownloadRate(since: Date): Promise<number | null> {
    const row = (await this.buildUploadToDownloadRateQuery(since).first()) as
      | UploadToDownloadRateRow
      | undefined;
    return mapUploadToDownloadRateRow(row);
  }

  async listPaidValueEvents(
    userIds: number[],
    since: Date
  ): Promise<PaidValueEventRow[]> {
    if (userIds.length === 0) {
      return [];
    }
    const rows = (await this.database('events')
      .select('user_id', 'name', 'created_at')
      .whereIn('user_id', userIds)
      .whereIn('name', [...PAID_VALUE_EVENT_NAMES])
      .where('created_at', '>=', since)) as Array<{
      user_id: number;
      name: string;
      created_at: Date | string;
    }>;
    return rows.map((row) => ({
      userId: Number(row.user_id),
      name: String(row.name),
      createdAt:
        row.created_at instanceof Date
          ? row.created_at
          : new Date(row.created_at),
    }));
  }
}

export default EventsMetricsRepository;
