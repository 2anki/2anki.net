import type { Knex } from 'knex';

import {
  EMPTY_REASON_PATTERNS,
  PAYWALL_REASON_PATTERNS,
  REASON_PROP_EXPRESSION,
} from './classifyFailureReason';
import { canonicalSurfaceSql } from '../lib/analytics/canonicalSurface';

export interface EventRow {
  name: string;
  user_id?: number | null;
  anonymous_id?: string | null;
  props: Record<string, unknown>;
  created_at?: Date;
}

export interface EventCountRow {
  count: number;
}

export interface PaywallShownByVariantRow {
  variant: string | null;
  surface: string | null;
  distinct_users: number;
}

export interface PaywallClicksByVariantRow {
  variant: string | null;
  click_count: number;
}

export interface UploadFunnelStageRow {
  stage: string;
  distinct_identities: number;
}

export interface UploadFunnelStageByOriginRow {
  origin: string | null;
  stage: string;
  distinct_identities: number;
}

export interface ConversionFailedByReasonRow {
  paywall: number;
  empty: number;
  technical: number;
}

const UPLOAD_FUNNEL_STAGES = [
  'upload_started',
  'conversion_succeeded',
  'conversion_failed',
  'deck_downloaded',
  'paywall_shown',
  'account_created',
  'checkout_completed',
];

export interface IEventsRepository {
  insertEvents(rows: EventRow[]): Promise<void>;
  lastEventAt(name: string, campaign?: string): Promise<Date | null>;
  countByName(name: string, since: Date): Promise<number>;
  countDistinctUsers(name: string, since: Date): Promise<number>;
  countByNameForUser(
    name: string,
    since: Date,
    userId: number | null,
    anonymousId: string | null
  ): Promise<number>;
  groupPaywallShownByVariantAndSurface(
    since: Date
  ): Promise<PaywallShownByVariantRow[]>;
  groupPaywallClicksByVariant(
    since: Date
  ): Promise<PaywallClicksByVariantRow[]>;
  groupUploadFunnel(since: Date): Promise<UploadFunnelStageRow[]>;
  groupUploadFunnelByOrigin(
    since: Date
  ): Promise<UploadFunnelStageByOriginRow[]>;
  groupConversionFailedByReason(
    since: Date
  ): Promise<ConversionFailedByReasonRow>;
}

export class EventsRepository implements IEventsRepository {
  private readonly table = 'events';

  constructor(private readonly database: Knex) {}

  async insertEvents(rows: EventRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.database(this.table).insert(rows);
  }

  async lastEventAt(name: string, campaign?: string): Promise<Date | null> {
    const query = this.database(this.table).where('name', name);

    if (campaign != null) {
      query.whereRaw("props->>'campaign' = ?", [campaign]);
    }

    const row = (await query.max('created_at as last_at').first()) as
      | { last_at: Date | string | null }
      | undefined;

    if (row?.last_at != null) return new Date(row.last_at);
    return null;
  }

  async countByName(name: string, since: Date): Promise<number> {
    const result = await this.database(this.table)
      .where('name', name)
      .where('created_at', '>=', since)
      .count('id as count')
      .first();
    return Number(result?.count ?? 0);
  }

  async countDistinctUsers(name: string, since: Date): Promise<number> {
    const result = await this.database(this.table)
      .where('name', name)
      .where('created_at', '>=', since)
      .whereNotNull('user_id')
      .countDistinct('user_id as count')
      .first();
    return Number(result?.count ?? 0);
  }

  async countByNameForUser(
    name: string,
    since: Date,
    userId: number | null,
    anonymousId: string | null
  ): Promise<number> {
    const query = this.database(this.table)
      .where('name', name)
      .where('created_at', '>=', since);

    if (userId != null) {
      query.where('user_id', userId);
    } else if (anonymousId != null) {
      query.where('anonymous_id', anonymousId);
    } else {
      return 0;
    }

    const result = await query.count('id as count').first();
    return Number(result?.count ?? 0);
  }

  async groupPaywallShownByVariantAndSurface(
    since: Date
  ): Promise<PaywallShownByVariantRow[]> {
    const rows = (await this.database(this.table)
      .where('name', 'paywall_shown')
      .where('created_at', '>=', since)
      .select(
        this.database.raw("props->>'variant' as variant"),
        this.database.raw(`${canonicalSurfaceSql()} as surface`),
        this.database.raw(
          'count(distinct COALESCE(user_id::text, anonymous_id)) as distinct_users'
        )
      )
      .groupByRaw(`props->>'variant', ${canonicalSurfaceSql()}`)) as Array<{
      variant: string | null;
      surface: string | null;
      distinct_users: string | number;
    }>;

    return rows.map((r) => ({
      variant: r.variant ?? null,
      surface: r.surface ?? null,
      distinct_users: Number(r.distinct_users),
    }));
  }

  async groupPaywallClicksByVariant(
    since: Date
  ): Promise<PaywallClicksByVariantRow[]> {
    const rows = (await this.database(this.table)
      .where('name', 'paywall_upgrade_clicked')
      .where('created_at', '>=', since)
      .select(this.database.raw("props->>'variant' as variant"))
      .count('id as click_count')
      .groupByRaw("props->>'variant'")) as Array<{
      variant: string | null;
      click_count: string | number;
    }>;

    return rows.map((r) => ({
      variant: r.variant ?? null,
      click_count: Number(r.click_count),
    }));
  }

  async groupUploadFunnel(since: Date): Promise<UploadFunnelStageRow[]> {
    const rows = (await this.database(this.table)
      .whereIn('name', UPLOAD_FUNNEL_STAGES)
      .where('created_at', '>=', since)
      .select(
        this.database.raw('name as stage'),
        this.database.raw(
          'count(distinct COALESCE(user_id::text, anonymous_id)) as distinct_identities'
        )
      )
      .groupBy('name')) as Array<{
      stage: string;
      distinct_identities: string | number;
    }>;

    return rows.map((r) => ({
      stage: r.stage,
      distinct_identities: Number(r.distinct_identities),
    }));
  }

  async groupUploadFunnelByOrigin(
    since: Date
  ): Promise<UploadFunnelStageByOriginRow[]> {
    const rows = (await buildUploadFunnelByOriginQuery(
      this.database,
      since
    )) as Array<{
      origin: string | null;
      stage: string;
      distinct_identities: string | number;
    }>;

    return rows.map((r) => ({
      origin: r.origin ?? null,
      stage: r.stage,
      distinct_identities: Number(r.distinct_identities),
    }));
  }

  async groupConversionFailedByReason(
    since: Date
  ): Promise<ConversionFailedByReasonRow> {
    const row = (await buildConversionFailedByReasonQuery(
      this.database,
      since
    ).first()) as
      | {
          paywall: string | number | null;
          empty: string | number | null;
          technical: string | number | null;
        }
      | undefined;

    return {
      paywall: Number(row?.paywall ?? 0),
      empty: Number(row?.empty ?? 0),
      technical: Number(row?.technical ?? 0),
    };
  }
}

function likeAnyCondition(patterns: string[]): string {
  return `(${patterns
    .map(() => `${REASON_PROP_EXPRESSION} LIKE ?`)
    .join(' OR ')})`;
}

function distinctIdentityWhen(condition: string): string {
  return `count(distinct case when ${condition} then COALESCE(user_id::text, anonymous_id) end)`;
}

export function buildConversionFailedByReasonQuery(
  database: Knex,
  since: Date
): Knex.QueryBuilder {
  const paywall = likeAnyCondition(PAYWALL_REASON_PATTERNS);
  const empty = likeAnyCondition(EMPTY_REASON_PATTERNS);
  const technical = `(${REASON_PROP_EXPRESSION} IS NULL OR (NOT ${paywall} AND NOT ${empty}))`;

  return database('events')
    .where('name', 'conversion_failed')
    .where('created_at', '>=', since)
    .select(
      database.raw(`${distinctIdentityWhen(paywall)} as paywall`, [
        ...PAYWALL_REASON_PATTERNS,
      ]),
      database.raw(`${distinctIdentityWhen(empty)} as empty`, [
        ...EMPTY_REASON_PATTERNS,
      ]),
      database.raw(`${distinctIdentityWhen(technical)} as technical`, [
        ...PAYWALL_REASON_PATTERNS,
        ...EMPTY_REASON_PATTERNS,
      ])
    );
}

export function buildUploadFunnelByOriginQuery(
  database: Knex,
  since: Date
): Knex.QueryBuilder {
  return database('events')
    .whereIn('name', UPLOAD_FUNNEL_STAGES)
    .where('created_at', '>=', since)
    .select(
      database.raw("props->>'signup_origin' as origin"),
      database.raw('name as stage'),
      database.raw(
        'count(distinct COALESCE(user_id::text, anonymous_id)) as distinct_identities'
      )
    )
    .groupByRaw("props->>'signup_origin', name")
    .orderByRaw("props->>'signup_origin' nulls last, name");
}

export default EventsRepository;
