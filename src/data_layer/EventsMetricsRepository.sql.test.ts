import knex from 'knex';

import {
  EventsMetricsRepository,
  mapConversionOutcomesRow,
  mapNewAccountDownloadsRow,
  mapUploadToDownloadRateRow,
} from './EventsMetricsRepository';

const cohortStart = new Date('2026-05-06T00:00:00.000Z');
const cohortEnd = new Date('2026-06-04T00:00:00.000Z');
const sevenDaysAgo = new Date('2026-05-29T00:00:00.000Z');

describe('EventsMetricsRepository generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new EventsMetricsRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('counts new accounts and those with a download in their first 24 hours in one left join', () => {
    const { sql } = repository
      .buildNewAccountDownloadsQuery(cohortStart, cohortEnd)
      .toSQL();

    expect(sql).toContain(
      'count(distinct accounts.user_id) as accounts, count(distinct downloads.user_id) as downloaded_24h'
    );
    expect(sql).toContain(
      "count(distinct case when downloads.created_at >= accounts.account_at + interval '10 minutes' then downloads.user_id end) as downloaded_after_signup"
    );
    expect(sql).toContain(
      'from (select "user_id", min("created_at") as "account_at" from "events" where "name" = ? and "created_at" >= ? and "created_at" <= ? and "user_id" is not null group by "user_id") as "accounts"'
    );
    expect(sql).toContain(
      'left join "events" as "downloads" on "downloads"."user_id" = "accounts"."user_id" and "downloads"."name" = ? and "downloads"."created_at" >= "accounts"."account_at" and downloads.created_at <= accounts.account_at + interval \'24 hours\''
    );
    expect(sql.match(/from "events"/g)).toHaveLength(1);
  });

  it('binds the account cohort window before the download event name, matching placeholder order', () => {
    const { sql, bindings } = repository
      .buildNewAccountDownloadsQuery(cohortStart, cohortEnd)
      .toSQL();

    expect(bindings).toEqual([
      'account_created',
      cohortStart,
      cohortEnd,
      'deck_downloaded',
    ]);
    expect(sql.match(/\?/g)).toHaveLength(bindings.length);
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

  describe('conversion outcomes', () => {
    it('reads conversion events inside the window, joined to users so anonymous events survive', () => {
      const { sql, bindings } = repository
        .buildConversionOutcomesQuery(sevenDaysAgo, 'free')
        .toSQL();

      expect(sql).toContain('from "events" left join "users"');
      expect(sql).toContain('"users"."id" = "events"."user_id"');
      expect(sql).toContain('"events"."name" in (?, ?)');
      expect(sql).toContain('"events"."created_at" >= ?');
      expect(bindings.slice(-3)).toEqual([
        'conversion_succeeded',
        'conversion_failed',
        sevenDaysAgo,
      ]);
    });

    it('treats a missing user or an empty Stripe customer id as free', () => {
      const { sql } = repository
        .buildConversionOutcomesQuery(sevenDaysAgo, 'free')
        .toSQL();

      expect(sql).toContain(
        "(users.stripe_customer_id IS NULL OR users.stripe_customer_id = '')"
      );
      expect(sql).not.toContain('users.stripe_customer_id IS NOT NULL');
    });

    it('treats a saved Stripe customer id as paid', () => {
      const { sql } = repository
        .buildConversionOutcomesQuery(sevenDaysAgo, 'paid')
        .toSQL();

      expect(sql).toContain(
        "users.stripe_customer_id IS NOT NULL AND users.stripe_customer_id != ''"
      );
      expect(sql).not.toContain('users.stripe_customer_id IS NULL');
    });

    it('counts succeeded events, technical failures and plan blocks as three columns', () => {
      const { sql } = repository
        .buildConversionOutcomesQuery(sevenDaysAgo, 'free')
        .toSQL();

      expect(sql).toContain(
        'count(case when events.name = ? then 1 end) as succeeded'
      );
      expect(sql).toContain('as technical_failed');
      expect(sql).toContain(
        "count(case when events.name = ? and (props->>'reason' LIKE ? OR props->>'reason' LIKE ? OR props->>'reason' LIKE ?) then 1 end) as plan_blocked"
      );
    });

    it('leaves paywall and empty-deck reasons out of the technical failures', () => {
      const { sql } = repository
        .buildConversionOutcomesQuery(sevenDaysAgo, 'free')
        .toSQL();

      expect(sql).toContain(
        "(props->>'reason' IS NULL OR (NOT (props->>'reason' LIKE ? OR props->>'reason' LIKE ? OR props->>'reason' LIKE ?) AND NOT (props->>'reason' LIKE ? OR props->>'reason' LIKE ? OR props->>'reason' LIKE ?)))"
      );
    });

    it('binds the shared paywall and empty reason patterns', () => {
      const { bindings } = repository
        .buildConversionOutcomesQuery(sevenDaysAgo, 'free')
        .toSQL();

      expect(bindings).toEqual([
        'conversion_succeeded',
        'conversion_failed',
        'monthly_limit',
        'anonymous_cap',
        '%"code":"monthly_limit"%',
        'empty_deck',
        'no_decks_created',
        'No cards in this deck yet.%',
        'conversion_failed',
        'monthly_limit',
        'anonymous_cap',
        '%"code":"monthly_limit"%',
        'conversion_succeeded',
        'conversion_failed',
        sevenDaysAgo,
      ]);
    });
  });
});

describe('mapConversionOutcomesRow', () => {
  it('returns zeros when the query yields no row', () => {
    expect(mapConversionOutcomesRow(undefined)).toEqual({
      succeeded: 0,
      technicalFailed: 0,
      planBlocked: 0,
    });
  });

  it('turns the string counts Postgres returns into numbers', () => {
    expect(
      mapConversionOutcomesRow({
        succeeded: '12',
        technical_failed: '3',
        plan_blocked: '5',
      })
    ).toEqual({ succeeded: 12, technicalFailed: 3, planBlocked: 5 });
  });

  it('treats null counts as zero', () => {
    expect(
      mapConversionOutcomesRow({
        succeeded: null,
        technical_failed: null,
        plan_blocked: null,
      })
    ).toEqual({ succeeded: 0, technicalFailed: 0, planBlocked: 0 });
  });
});

describe('mapNewAccountDownloadsRow', () => {
  it('returns null when the query yields no row', () => {
    expect(mapNewAccountDownloadsRow(undefined)).toBeNull();
  });

  it('reads the three Postgres counts, which arrive as strings, as numbers', () => {
    expect(
      mapNewAccountDownloadsRow({
        accounts: '701',
        downloaded_24h: '376',
        downloaded_after_signup: '82',
      })
    ).toEqual({
      accounts: 701,
      downloadedWithin24h: 376,
      downloadedAfterSignup: 82,
    });
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
