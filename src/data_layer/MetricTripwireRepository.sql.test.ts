import knex from 'knex';

import { SERVER_ONLY_EVENT_NAMES } from '../lib/events/serverEventProps';
import {
  buildAlertExistsQuery,
  buildConversionOutcomeQuery,
  buildFollowThroughQuery,
  buildLastCheckedQuery,
  buildRecordAlertQuery,
  buildRecordCheckQuery,
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

  // The ingest drops the anonymous id from a client event unless tracking is
  // allowed (consent granted, or outside the consent region; #4730), while a
  // server-written event keeps it from the cookie. A server base paired with a
  // client follow-up therefore never matches an untracked visitor, so the
  // anonymous rate follows the tracking rate instead of the behaviour.
  it('scopes every server base paired with a client follow-up to signed-in users', () => {
    const mixed = Object.entries(FOLLOW_THROUGH_SPECS).filter(
      ([, spec]) =>
        SERVER_ONLY_EVENT_NAMES.has(spec.baseEvent) &&
        spec.followEvents.some((name) => !SERVER_ONLY_EVENT_NAMES.has(name))
    );

    expect(mixed.map(([key]) => key)).toContain('download_after_success');
    expect(mixed.filter(([, spec]) => spec.identity !== 'signed_in')).toEqual(
      []
    );
  });

  it('keeps the upload follow-through open to anonymous visitors', () => {
    const { sql, bindings } = buildFollowThroughQuery(
      pg,
      FOLLOW_THROUGH_SPECS.upload_after_page_view,
      start,
      end
    ).toSQL();

    expect(sql).not.toContain('"user_id" is');
    expect(sql).not.toContain('props @>');
    expect(bindings).toEqual([
      'upload_page_viewed',
      start,
      end,
      'upload_started',
      start,
      end,
    ]);
  });

  it('restricts the download follow-through to signed-in users', () => {
    const { sql, bindings } = buildFollowThroughQuery(
      pg,
      FOLLOW_THROUGH_SPECS.download_after_success,
      start,
      end
    ).toSQL();

    expect(sql).toContain('and "user_id" is not null)');
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

  it('looks up a prior alert only among rows the server wrote', () => {
    const { sql, bindings } = buildAlertExistsQuery(
      pg,
      'conversion_success',
      '2026-10-26'
    ).toSQL();

    expect(sql).toBe(
      'select "id" from "events" where "name" = ? and "user_id" is null ' +
        'and "anonymous_id" is null and props @> ?::jsonb ' +
        'and "created_at" >= ? limit ?'
    );
    expect(bindings).toEqual([
      'metric_tripwire_alert_sent',
      JSON.stringify({
        metric: 'conversion_success',
        day: '2026-10-26',
        server_marker: true,
      }),
      new Date('2026-10-27T00:00:00.000Z'),
      1,
    ]);
  });

  it('reads the last check only from rows the server wrote', () => {
    const { sql, bindings } = buildLastCheckedQuery(pg).toSQL();

    expect(sql).toBe(
      'select max("created_at") as "last_at" from "events" where "name" = ? ' +
        'and "user_id" is null and "anonymous_id" is null and props @> ?::jsonb'
    );
    expect(bindings).toEqual([
      'metric_tripwire_checked',
      JSON.stringify({ server_marker: true }),
    ]);
  });

  it('writes the marker and the app-clock time every bookkeeping read requires', () => {
    const at = new Date('2026-10-27T00:00:01.000Z');
    const alert = buildRecordAlertQuery(pg, 'deck_has_cards', '2026-10-26', at);
    const check = buildRecordCheckQuery(pg, '2026-10-26', 2, at);

    expect(alert.toSQL().sql).toBe(
      'insert into "events" ("created_at", "name", "props") values (?, ?, ?)'
    );
    expect(alert.toSQL().bindings).toEqual([
      at,
      'metric_tripwire_alert_sent',
      JSON.stringify({
        metric: 'deck_has_cards',
        day: '2026-10-26',
        server_marker: true,
      }),
    ]);
    expect(check.toSQL().bindings).toEqual([
      at,
      'metric_tripwire_checked',
      JSON.stringify({ day: '2026-10-26', tripped: 2, server_marker: true }),
    ]);
  });
});
