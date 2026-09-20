import type { Knex } from 'knex';

import {
  EMPTY_REASON_PATTERNS,
  PAYWALL_REASON_PATTERNS,
  REASON_PROP_EXPRESSION,
} from './classifyFailureReason';

export type ConversionTier = 'free' | 'paid';

export interface ConversionOutcomeCounts {
  succeeded: number;
  technicalFailed: number;
  planBlocked: number;
}

export interface IEventsMetricsRepository {
  newAccountDownloads(
    cohortStart: Date,
    cohortEnd: Date
  ): Promise<NewAccountDownloadCounts | null>;
  uploadToDownloadRate(since: Date): Promise<number | null>;
  conversionOutcomes(
    since: Date,
    tier: ConversionTier
  ): Promise<ConversionOutcomeCounts>;
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

type PostgresNumeric = number | string | null;

export interface NewAccountDownloadsRow {
  accounts: PostgresNumeric;
  downloaded_24h: PostgresNumeric;
  downloaded_after_signup: PostgresNumeric;
}

export interface NewAccountDownloadCounts {
  accounts: number;
  downloadedWithin24h: number;
  downloadedAfterSignup: number;
}

// Nearly every signup's first download lands within minutes, because the deck
// they made before signing up downloads the moment they sign in. Anything past
// this many minutes is a deck made after signing up.
const HELD_DECK_DOWNLOAD_MINUTES = 10;

export interface UploadToDownloadRateRow {
  uploaders: number | string;
  downloaders: number | string;
}

export interface ConversionOutcomesRow {
  succeeded: PostgresNumeric;
  technical_failed: PostgresNumeric;
  plan_blocked: PostgresNumeric;
}

const PAID_CUSTOMER_FILTER =
  "users.stripe_customer_id IS NOT NULL AND users.stripe_customer_id != ''";
const FREE_CUSTOMER_FILTER =
  "(users.stripe_customer_id IS NULL OR users.stripe_customer_id = '')";

function likeAnyReason(patterns: string[]): string {
  return `(${patterns
    .map(() => `${REASON_PROP_EXPRESSION} LIKE ?`)
    .join(' OR ')})`;
}

export function mapConversionOutcomesRow(
  row: ConversionOutcomesRow | undefined
): ConversionOutcomeCounts {
  return {
    succeeded: Number(row?.succeeded ?? 0),
    technicalFailed: Number(row?.technical_failed ?? 0),
    planBlocked: Number(row?.plan_blocked ?? 0),
  };
}

export function mapNewAccountDownloadsRow(
  row: NewAccountDownloadsRow | undefined
): NewAccountDownloadCounts | null {
  if (row == null) return null;
  return {
    accounts: Number(row.accounts),
    downloadedWithin24h: Number(row.downloaded_24h),
    downloadedAfterSignup: Number(row.downloaded_after_signup),
  };
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

  buildNewAccountDownloadsQuery(
    cohortStart: Date,
    cohortEnd: Date
  ): Knex.QueryBuilder {
    const accounts = this.database('events')
      .select('user_id')
      .min('created_at as account_at')
      .where('name', 'account_created')
      .where('created_at', '>=', cohortStart)
      .where('created_at', '<=', cohortEnd)
      .whereNotNull('user_id')
      .groupBy('user_id')
      .as('accounts');
    const database = this.database;

    return this.database
      .from(accounts)
      .leftJoin('events as downloads', function () {
        this.on('downloads.user_id', 'accounts.user_id')
          .andOnVal('downloads.name', 'deck_downloaded')
          .andOn('downloads.created_at', '>=', 'accounts.account_at')
          .andOn(
            database.raw(
              "downloads.created_at <= accounts.account_at + interval '24 hours'"
            )
          );
      })
      .select(
        this.database.raw(
          'count(distinct accounts.user_id) as accounts, count(distinct downloads.user_id) as downloaded_24h'
        ),
        this.database.raw(
          `count(distinct case when downloads.created_at >= accounts.account_at + interval '${HELD_DECK_DOWNLOAD_MINUTES} minutes' then downloads.user_id end) as downloaded_after_signup`
        )
      );
  }

  async newAccountDownloads(
    cohortStart: Date,
    cohortEnd: Date
  ): Promise<NewAccountDownloadCounts | null> {
    const row = (await this.buildNewAccountDownloadsQuery(
      cohortStart,
      cohortEnd
    ).first()) as NewAccountDownloadsRow | undefined;
    return mapNewAccountDownloadsRow(row);
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

  buildConversionOutcomesQuery(
    since: Date,
    tier: ConversionTier
  ): Knex.QueryBuilder {
    const paywall = likeAnyReason(PAYWALL_REASON_PATTERNS);
    const empty = likeAnyReason(EMPTY_REASON_PATTERNS);
    const technical = `(${REASON_PROP_EXPRESSION} IS NULL OR (NOT ${paywall} AND NOT ${empty}))`;

    return this.database('events')
      .leftJoin('users', 'users.id', 'events.user_id')
      .whereIn('events.name', ['conversion_succeeded', 'conversion_failed'])
      .where('events.created_at', '>=', since)
      .whereRaw(tier === 'paid' ? PAID_CUSTOMER_FILTER : FREE_CUSTOMER_FILTER)
      .select(
        this.database.raw(
          'count(case when events.name = ? then 1 end) as succeeded',
          ['conversion_succeeded']
        ),
        this.database.raw(
          `count(case when events.name = ? and ${technical} then 1 end) as technical_failed`,
          [
            'conversion_failed',
            ...PAYWALL_REASON_PATTERNS,
            ...EMPTY_REASON_PATTERNS,
          ]
        ),
        this.database.raw(
          `count(case when events.name = ? and ${paywall} then 1 end) as plan_blocked`,
          ['conversion_failed', ...PAYWALL_REASON_PATTERNS]
        )
      );
  }

  async conversionOutcomes(
    since: Date,
    tier: ConversionTier
  ): Promise<ConversionOutcomeCounts> {
    const row = (await this.buildConversionOutcomesQuery(
      since,
      tier
    ).first()) as ConversionOutcomesRow | undefined;
    return mapConversionOutcomesRow(row);
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
