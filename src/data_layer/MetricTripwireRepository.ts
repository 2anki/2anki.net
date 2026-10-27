import type { Knex } from 'knex';

import { SERVER_MARKER_PROP } from '../lib/events/serverEventProps';
import type { KnownEvent } from '../types/AnalyticsEvents';

export interface RateCountsRow {
  numerator: number;
  denominator: number;
}

export type FollowThroughMetricKey =
  | 'download_after_success'
  | 'upload_after_page_view'
  | 'partial_notice_signed_in'
  | 'partial_notice_anonymous';

export type TripwireMetricKey =
  | 'conversion_success'
  | 'deck_has_cards'
  | FollowThroughMetricKey;

export type TripwireRateCounts = Record<TripwireMetricKey, RateCountsRow>;

export interface FollowThroughSpec {
  baseEvent: KnownEvent;
  baseProps: Record<string, string | boolean> | null;
  identity: 'any' | 'signed_in' | 'anonymous';
  followEvents: KnownEvent[];
}

const PARTIAL_UPLOAD_PROPS = { card_limit_partial: true, source: 'upload' };
const PARTIAL_NOTICE_EVENTS: KnownEvent[] = [
  'monthly_partial_offer_shown',
  'anonymous_partial_gate_shown',
];

export const FOLLOW_THROUGH_SPECS: Record<
  FollowThroughMetricKey,
  FollowThroughSpec
> = {
  download_after_success: {
    baseEvent: 'conversion_succeeded',
    baseProps: null,
    identity: 'any',
    followEvents: ['deck_downloaded'],
  },
  upload_after_page_view: {
    baseEvent: 'upload_page_viewed',
    baseProps: null,
    identity: 'any',
    followEvents: ['upload_started'],
  },
  partial_notice_signed_in: {
    baseEvent: 'conversion_succeeded',
    baseProps: PARTIAL_UPLOAD_PROPS,
    identity: 'signed_in',
    followEvents: PARTIAL_NOTICE_EVENTS,
  },
  partial_notice_anonymous: {
    baseEvent: 'conversion_succeeded',
    baseProps: PARTIAL_UPLOAD_PROPS,
    identity: 'anonymous',
    followEvents: PARTIAL_NOTICE_EVENTS,
  },
};

const IDENTITY_SQL = 'coalesce(user_id::text, anonymous_id)';
const UTC_DAY_SQL = "date_trunc('day', created_at at time zone 'UTC')";
const ALERT_EVENT: KnownEvent = 'metric_tripwire_alert_sent';
const CHECK_EVENT: KnownEvent = 'metric_tripwire_checked';

export function buildConversionOutcomeQuery(
  db: Knex,
  start: Date,
  end: Date
): Knex.QueryBuilder {
  return db('events')
    .select(
      db.raw('count(*) filter (where name = ?) as succeeded', [
        'conversion_succeeded',
      ]),
      db.raw('count(*) filter (where name = ?) as failed', [
        'conversion_failed',
      ]),
      db.raw(
        "count(*) filter (where name = ? and props->>'card_count_bucket' is not null) as bucketed",
        ['conversion_succeeded']
      ),
      db.raw(
        "count(*) filter (where name = ? and props->>'card_count_bucket' <> ?) as with_cards",
        ['conversion_succeeded', '<3']
      )
    )
    .whereIn('name', ['conversion_succeeded', 'conversion_failed'])
    .where('created_at', '>=', start)
    .where('created_at', '<', end);
}

function identityDaysQuery(
  db: Knex,
  names: KnownEvent[],
  start: Date,
  end: Date
): Knex.QueryBuilder {
  const query = db('events').distinct(
    db.raw(`${IDENTITY_SQL} as ident`),
    db.raw(`${UTC_DAY_SQL} as day`)
  );
  if (names.length === 1) {
    query.where('name', names[0]);
  } else {
    query.whereIn('name', names);
  }
  return query.where('created_at', '>=', start).where('created_at', '<', end);
}

export function buildFollowThroughQuery(
  db: Knex,
  spec: FollowThroughSpec,
  start: Date,
  end: Date
): Knex.QueryBuilder {
  const base = identityDaysQuery(db, [spec.baseEvent], start, end).whereRaw(
    `${IDENTITY_SQL} is not null`
  );
  if (spec.baseProps != null) {
    base.whereRaw('props @> ?::jsonb', [JSON.stringify(spec.baseProps)]);
  }
  if (spec.identity === 'signed_in') {
    base.whereNotNull('user_id');
  } else if (spec.identity === 'anonymous') {
    base.whereNull('user_id');
  }
  const follow = identityDaysQuery(db, spec.followEvents, start, end);

  return db
    .with('base', base)
    .with('follow', follow)
    .select(
      db.raw('count(*) as denominator'),
      db.raw('count(follow.ident) as numerator')
    )
    .from('base')
    .leftJoin('follow', function joinSameIdentityAndDay() {
      this.on('base.ident', '=', 'follow.ident').andOn(
        'base.day',
        '=',
        'follow.day'
      );
    });
}

function serverProps(
  props: Record<string, string | number>
): Record<string, string | number | boolean> {
  return { ...props, [SERVER_MARKER_PROP]: true };
}

function serverRowsQuery(
  db: Knex,
  name: KnownEvent,
  props: Record<string, string | number>
): Knex.QueryBuilder {
  return db('events')
    .where('name', name)
    .whereNull('user_id')
    .whereNull('anonymous_id')
    .whereRaw('props @> ?::jsonb', [JSON.stringify(serverProps(props))]);
}

export function buildAlertExistsQuery(
  db: Knex,
  metric: TripwireMetricKey,
  day: string
): Knex.QueryBuilder {
  return serverRowsQuery(db, ALERT_EVENT, { metric, day })
    .select('id')
    .limit(1);
}

export function buildLastCheckedQuery(db: Knex): Knex.QueryBuilder {
  return serverRowsQuery(db, CHECK_EVENT, {}).max('created_at as last_at');
}

export function buildRecordAlertQuery(
  db: Knex,
  metric: TripwireMetricKey,
  day: string
): Knex.QueryBuilder {
  return db('events').insert({
    name: ALERT_EVENT,
    props: JSON.stringify(serverProps({ metric, day })),
  });
}

export function buildRecordCheckQuery(
  db: Knex,
  day: string,
  tripped: number
): Knex.QueryBuilder {
  return db('events').insert({
    name: CHECK_EVENT,
    props: JSON.stringify(serverProps({ day, tripped })),
  });
}

export interface IMetricTripwireRepository {
  countRates(start: Date, end: Date): Promise<TripwireRateCounts>;
  lastCheckedAt(): Promise<Date | null>;
  hasAlerted(metric: TripwireMetricKey, day: string): Promise<boolean>;
  recordAlert(metric: TripwireMetricKey, day: string): Promise<void>;
  recordCheck(day: string, tripped: number): Promise<void>;
}

export class MetricTripwireRepository implements IMetricTripwireRepository {
  constructor(private readonly database: Knex) {}

  async countRates(start: Date, end: Date): Promise<TripwireRateCounts> {
    const outcomes = (await buildConversionOutcomeQuery(
      this.database,
      start,
      end
    ).first()) as
      | Record<
          'succeeded' | 'failed' | 'bucketed' | 'with_cards',
          string | number
        >
      | undefined;
    const succeeded = Number(outcomes?.succeeded ?? 0);
    const failed = Number(outcomes?.failed ?? 0);

    const followThrough = {} as Record<FollowThroughMetricKey, RateCountsRow>;
    for (const key of Object.keys(
      FOLLOW_THROUGH_SPECS
    ) as FollowThroughMetricKey[]) {
      const row = (await buildFollowThroughQuery(
        this.database,
        FOLLOW_THROUGH_SPECS[key],
        start,
        end
      ).first()) as
        | { numerator: string | number; denominator: string | number }
        | undefined;
      followThrough[key] = {
        numerator: Number(row?.numerator ?? 0),
        denominator: Number(row?.denominator ?? 0),
      };
    }

    return {
      conversion_success: {
        numerator: succeeded,
        denominator: succeeded + failed,
      },
      deck_has_cards: {
        numerator: Number(outcomes?.with_cards ?? 0),
        denominator: Number(outcomes?.bucketed ?? 0),
      },
      ...followThrough,
    };
  }

  async lastCheckedAt(): Promise<Date | null> {
    const row = (await buildLastCheckedQuery(this.database).first()) as
      | { last_at: Date | string | null }
      | undefined;
    return row?.last_at == null ? null : new Date(row.last_at);
  }

  async hasAlerted(metric: TripwireMetricKey, day: string): Promise<boolean> {
    const row = await buildAlertExistsQuery(this.database, metric, day).first();
    return row != null;
  }

  async recordAlert(metric: TripwireMetricKey, day: string): Promise<void> {
    await buildRecordAlertQuery(this.database, metric, day);
  }

  async recordCheck(day: string, tripped: number): Promise<void> {
    await buildRecordCheckQuery(this.database, day, tripped);
  }
}
