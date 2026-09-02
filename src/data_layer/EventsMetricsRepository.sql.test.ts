import knex from 'knex';

import {
  EventsMetricsRepository,
  mapMedianMinutesRow,
  mapUploadToDownloadRateRow,
} from './EventsMetricsRepository';

const cohortStart = new Date('2026-05-06T00:00:00.000Z');
const sevenDaysAgo = new Date('2026-05-29T00:00:00.000Z');

describe('EventsMetricsRepository generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new EventsMetricsRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('computes the time-to-first-deck median over joined first-event subqueries', () => {
    const { sql } = repository
      .buildMedianMinutesToFirstDeckQuery(cohortStart)
      .toSQL();

    expect(sql).toBe(
      'select percentile_cont(0.5) within group (order by extract(epoch from (downloads.first_download_at - accounts.account_at)) / 60) as median_minutes ' +
        'from (select "user_id", min("created_at") as "account_at" from "events" where "name" = ? and "created_at" >= ? and "user_id" is not null group by "user_id") as "accounts" ' +
        'inner join (select "user_id", min("created_at") as "first_download_at" from "events" where "name" = ? and "user_id" is not null group by "user_id") as "downloads" ' +
        'on "downloads"."user_id" = "accounts"."user_id" ' +
        'where downloads.first_download_at >= accounts.account_at'
    );
  });

  it('binds account_created and deck_downloaded into the median query', () => {
    const { bindings } = repository
      .buildMedianMinutesToFirstDeckQuery(cohortStart)
      .toSQL();

    expect(bindings).toEqual([
      'account_created',
      cohortStart,
      'deck_downloaded',
    ]);
  });

  it('counts distinct coalesced actors per funnel stage for the upload-to-download rate', () => {
    const { sql } = repository
      .buildUploadToDownloadRateQuery(sevenDaysAgo)
      .toSQL();

    expect(sql).toBe(
      'select count(distinct case when name = ? then COALESCE(user_id::text, anonymous_id) end) as uploaders, ' +
        'count(distinct case when name = ? then COALESCE(user_id::text, anonymous_id) end) as downloaders ' +
        'from "events" where "created_at" >= ? and "name" in (?, ?)'
    );
  });

  it('binds the stage names and window into the rate query', () => {
    const { bindings } = repository
      .buildUploadToDownloadRateQuery(sevenDaysAgo)
      .toSQL();

    expect(bindings).toEqual([
      'upload_started',
      'deck_downloaded',
      sevenDaysAgo,
      'upload_started',
      'deck_downloaded',
    ]);
  });

  it('counts pass checkouts by plan inside the window', () => {
    const sql = repository.buildPassSalesQuery(sevenDaysAgo).toString();

    expect(sql).toContain('"events"');
    expect(sql).toContain("props->>'plan' as plan");
    expect(sql).toContain('"name" = \'checkout_completed\'');
    expect(sql).toContain('"created_at" >=');
    expect(sql).toContain("props->>'plan' in ('24h', '7d', '120d')");
    expect(sql).toContain('group by "plan"');
    expect(sql).toContain('count(*)');
  });
});

describe('mapMedianMinutesRow', () => {
  it('returns null when the query yields no row', () => {
    expect(mapMedianMinutesRow(undefined)).toBeNull();
  });

  it('returns null when percentile_cont returns null', () => {
    expect(mapMedianMinutesRow({ median_minutes: null })).toBeNull();
  });

  it('returns the median as a number when the row carries a string', () => {
    expect(mapMedianMinutesRow({ median_minutes: '42.5' })).toBe(42.5);
  });
});

describe('mapUploadToDownloadRateRow', () => {
  it('returns null when the query yields no row', () => {
    expect(mapUploadToDownloadRateRow(undefined)).toBeNull();
  });

  it('returns null when there are no uploaders', () => {
    expect(
      mapUploadToDownloadRateRow({ uploaders: '0', downloaders: '0' })
    ).toBeNull();
  });

  it('returns the rate as a percentage of distinct actors', () => {
    expect(
      mapUploadToDownloadRateRow({ uploaders: '80', downloaders: '20' })
    ).toBe(25);
  });
});
