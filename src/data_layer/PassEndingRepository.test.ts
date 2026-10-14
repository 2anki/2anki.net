import knex, { Knex } from 'knex';

import {
  InMemoryPassEndingRepository,
  PassEndingRepository,
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
});

describe('InMemoryPassEndingRepository', () => {
  const pass = {
    passId: 11,
    userId: 7,
    email: 'ada@example.com',
    kind: '7d' as const,
  };

  it('claims a pass once and rejects a second claim for the same pass', async () => {
    const repo = new InMemoryPassEndingRepository();

    expect(await repo.claimNotification(7, 11, 'tok-1')).toBe(true);
    expect(await repo.claimNotification(7, 11, 'tok-2')).toBe(false);
    expect(repo.getClaims()).toEqual([
      { userId: 7, campaign: passEndingCampaign(11) },
    ]);
  });

  it('drops a claimed pass from the next read', async () => {
    const repo = new InMemoryPassEndingRepository();
    repo.seedPasses([pass, { ...pass, passId: 12, userId: 8 }]);

    await repo.claimNotification(7, 11, 'tok-1');

    expect(await repo.getPassesEndingSoon(24)).toEqual([
      { ...pass, passId: 12, userId: 8 },
    ]);
  });
});
