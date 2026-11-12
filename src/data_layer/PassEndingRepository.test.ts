import knex, { Knex } from 'knex';

import {
  InMemoryPassEndingRepository,
  PassEndingRepository,
  passEmailCampaign,
  passEndingCampaign,
} from './PassEndingRepository';

describe('PassEndingRepository generated SQL (postgres dialect)', () => {
  let pg: Knex;

  beforeAll(() => {
    pg = knex({ client: 'pg' });
  });

  afterAll(async () => {
    await pg.destroy();
  });

  it('selects Week and Semester passes ending inside the window with every exclusion', () => {
    const repo = new PassEndingRepository(pg);
    const sql = repo.buildPassesEndingSoonQuery(24, 200).toString();

    expect(sql).toContain(`"user_passes"."kind" in ('7d', '120d')`);
    expect(sql).toContain('user_passes.expires_at > now()');
    expect(sql).toContain(
      'user_passes.expires_at <= now() + make_interval(hours => 24)'
    );
    expect(sql).toContain('users.patreon IS NOT TRUE');
    expect(sql).toContain(
      'subscriptions.email = users.email OR subscriptions.linked_email = users.email'
    );
    expect(sql).toContain('email_preferences.user_id = users.id');
    expect(sql).toContain(
      `pass_winback_notifications.campaign = 'pass_ending:' || user_passes.id::text`
    );
    expect(sql).toContain('order by "user_passes"."expires_at" asc');
    expect(sql).toContain('limit 200');
  });

  it('leaves Day Passes out of the audience', () => {
    const repo = new PassEndingRepository(pg);
    const sql = repo.buildPassesEndingSoonQuery(24, 200).toString();

    expect(sql).not.toContain(`'24h'`);
  });

  it('skips a pass that a later pass already extends', () => {
    const repo = new PassEndingRepository(pg);
    const sql = repo.buildPassesEndingSoonQuery(24, 200).toString();

    expect(sql).toContain('later_passes.user_id = user_passes.user_id');
    expect(sql).toContain('later_passes.expires_at > user_passes.expires_at');
  });
});

describe('PassEndingRepository renewal audience SQL (postgres dialect)', () => {
  let pg: Knex;

  beforeAll(() => {
    pg = knex({ client: 'pg' });
  });

  afterAll(async () => {
    await pg.destroy();
  });

  it('selects Semester Passes ending between 1 and 7 days out with every exclusion', () => {
    const repo = new PassEndingRepository(pg);
    const sql = repo.buildSemesterPassesUpForRenewalQuery(200).toString();

    expect(sql).toContain(`"user_passes"."kind" in ('120d')`);
    expect(sql).toContain(
      'user_passes.expires_at > now() + make_interval(hours => 24)'
    );
    expect(sql).toContain(
      'user_passes.expires_at <= now() + make_interval(hours => 168)'
    );
    expect(sql).toContain('users.patreon IS NOT TRUE');
    expect(sql).toContain(
      'subscriptions.email = users.email OR subscriptions.linked_email = users.email'
    );
    expect(sql).toContain('"email_preferences"."marketing_opt_out" = true');
    expect(sql).toContain('later_passes.expires_at > user_passes.expires_at');
    expect(sql).toContain(
      `pass_winback_notifications.campaign = 'pass_renewal:' || user_passes.id::text`
    );
    expect(sql).toContain('limit 200');
  });

  it('leaves Day and Week Passes out of the renewal audience', () => {
    const repo = new PassEndingRepository(pg);
    const sql = repo.buildSemesterPassesUpForRenewalQuery(200).toString();

    expect(sql).not.toContain(`'24h'`);
    expect(sql).not.toContain(`'7d'`);
  });

  it('leaves out a holder who also has another kind of pass running', () => {
    const repo = new PassEndingRepository(pg);
    const sql = repo.buildSemesterPassesUpForRenewalQuery(200).toString();

    expect(sql).toContain('other_passes.user_id = user_passes.user_id');
    expect(sql).toContain('other_passes.expires_at > now()');
    expect(sql).toContain("other_passes.kind <> '120d'");
  });

  it('keeps the other-pass exclusion out of the day-before note', () => {
    const repo = new PassEndingRepository(pg);
    const sql = repo.buildPassesEndingSoonQuery(24, 200).toString();

    expect(sql).not.toContain('other_passes');
  });
});

describe('InMemoryPassEndingRepository', () => {
  const pass = {
    passId: 11,
    userId: 7,
    email: 'ada@example.com',
    kind: '7d' as const,
    expiresAt: new Date('2027-01-20T00:00:00.000Z'),
  };

  it('claims a pass once and rejects a second claim for the same pass', async () => {
    const repo = new InMemoryPassEndingRepository();

    expect(await repo.claimNotification(7, 11, 'tok-1', 'pass_ending')).toBe(
      true
    );
    expect(await repo.claimNotification(7, 11, 'tok-2', 'pass_ending')).toBe(
      false
    );
    expect(repo.getClaims()).toEqual([
      { userId: 7, campaign: passEndingCampaign(11) },
    ]);
  });

  it('drops a claimed pass from the next read', async () => {
    const repo = new InMemoryPassEndingRepository();
    repo.seedPasses([pass, { ...pass, passId: 12, userId: 8 }]);

    await repo.claimNotification(7, 11, 'tok-1', 'pass_ending');

    expect(await repo.getPassesEndingSoon(24)).toEqual([
      { ...pass, passId: 12, userId: 8 },
    ]);
  });

  it('keeps the renewal and day-before claims for one pass apart', async () => {
    const repo = new InMemoryPassEndingRepository();
    const semester = { ...pass, kind: '120d' as const };
    repo.seedPasses([semester]);
    repo.seedRenewalPasses([semester]);

    expect(await repo.claimNotification(7, 11, 'tok-1', 'pass_renewal')).toBe(
      true
    );

    expect(await repo.getSemesterPassesUpForRenewal()).toEqual([]);
    expect(await repo.getPassesEndingSoon(24)).toEqual([semester]);
    expect(repo.getClaims()).toEqual([
      { userId: 7, campaign: passEmailCampaign('pass_renewal', 11) },
    ]);
  });
});
