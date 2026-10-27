import knex from 'knex';

import {
  buildAlertExistsQuery,
  buildConversionOutcomeQuery,
  buildFollowThroughQuery,
  FOLLOW_THROUGH_SPECS,
} from './MetricTripwireRepository';

describe('MetricTripwireRepository generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const start = new Date('2026-10-26T00:00:00.000Z');
  const end = new Date('2026-10-27T00:00:00.000Z');

  afterAll(async () => {
    await pg.destroy();
  });

  it('counts conversion outcomes and non-empty decks in one pass over the window', () => {
    const { sql, bindings } = buildConversionOutcomeQuery(
      pg,
      start,
      end
    ).toSQL();

    expect(sql).toBe(
      'select count(*) filter (where name = ?) as succeeded, ' +
        'count(*) filter (where name = ?) as failed, ' +
        "count(*) filter (where name = ? and props->>'card_count_bucket' is not null) as bucketed, " +
        "count(*) filter (where name = ? and props->>'card_count_bucket' <> ?) as with_cards " +
        'from "events" where "name" in (?, ?) and "created_at" >= ? and "created_at" < ?'
    );
    expect(bindings).toEqual([
      'conversion_succeeded',
      'conversion_failed',
      'conversion_succeeded',
      'conversion_succeeded',
      '<3',
      'conversion_succeeded',
      'conversion_failed',
      start,
      end,
    ]);
  });

  it('pairs each signed-in partial with a notice shown to the same person on the same UTC day', () => {
    const { sql, bindings } = buildFollowThroughQuery(
      pg,
      FOLLOW_THROUGH_SPECS.partial_notice_signed_in,
      start,
      end
    ).toSQL();

    const identity = 'coalesce(user_id::text, anonymous_id)';
    const day = "date_trunc('day', created_at at time zone 'UTC')";
    expect(sql).toBe(
      `with "base" as (select distinct ${identity} as ident, ${day} as day from "events" ` +
        `where "name" = ? and "created_at" >= ? and "created_at" < ? and ${identity} is not null ` +
        'and props @> ?::jsonb and "user_id" is not null), ' +
        `"follow" as (select distinct ${identity} as ident, ${day} as day from "events" ` +
        'where "name" in (?, ?) and "created_at" >= ? and "created_at" < ?) ' +
        'select count(*) as denominator, count(follow.ident) as numerator from "base" ' +
        'left join "follow" on "base"."ident" = "follow"."ident" and "base"."day" = "follow"."day"'
    );
    expect(bindings).toEqual([
      'conversion_succeeded',
      start,
      end,
      JSON.stringify({ card_limit_partial: true, source: 'upload' }),
      'monthly_partial_offer_shown',
      'anonymous_partial_gate_shown',
      start,
      end,
    ]);
  });

  it('restricts the anonymous partial base to rows without a user', () => {
    const { sql } = buildFollowThroughQuery(
      pg,
      FOLLOW_THROUGH_SPECS.partial_notice_anonymous,
      start,
      end
    ).toSQL();

    expect(sql).toContain('and "user_id" is null)');
  });

  it('leaves the identity scope open for the download follow-through', () => {
    const { sql, bindings } = buildFollowThroughQuery(
      pg,
      FOLLOW_THROUGH_SPECS.download_after_success,
      start,
      end
    ).toSQL();

    expect(sql).not.toContain('"user_id" is');
    expect(sql).not.toContain('props @>');
    expect(bindings).toEqual([
      'conversion_succeeded',
      start,
      end,
      'deck_downloaded',
      start,
      end,
    ]);
  });

  it('looks up a prior alert by metric and day', () => {
    const { sql, bindings } = buildAlertExistsQuery(
      pg,
      'conversion_success',
      '2026-10-26'
    ).toSQL();

    expect(sql).toBe(
      'select "id" from "events" where "name" = ? and props @> ?::jsonb limit ?'
    );
    expect(bindings).toEqual([
      'metric_tripwire_alert_sent',
      JSON.stringify({ metric: 'conversion_success', day: '2026-10-26' }),
      1,
    ]);
  });
});
