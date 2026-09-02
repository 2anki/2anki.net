import knex, { Knex } from 'knex';
import {
  InMemoryPassWinbackRepository,
  PassWinbackRepository,
} from './PassWinbackRepository';

const CAMPAIGN = 'winback-2026-fall';

describe('PassWinbackRepository generated SQL (postgres dialect)', () => {
  let pg: Knex;

  beforeAll(() => {
    pg = knex({ client: 'pg' });
  });

  afterAll(async () => {
    await pg.destroy();
  });

  it('selects lapsed paid-pass buyers with every exclusion clause', () => {
    const repo = new PassWinbackRepository(pg);
    const sql = repo.buildExpiredPassBuyersQuery(CAMPAIGN, 500).toString();

    expect(sql).toContain('users.patreon IS NOT TRUE');
    expect(sql).toContain(`"user_passes"."kind" in ('24h', '7d', '120d')`);
    expect(sql).toContain('user_passes.expires_at > now()');
    expect(sql).toContain(
      'subscriptions.email = users.email OR subscriptions.linked_email = users.email'
    );
    expect(sql).toContain('email_preferences.user_id = users.id');
    expect(sql).toContain('pass_winback_notifications.user_id = users.id');
    expect(sql).toContain(
      `"pass_winback_notifications"."campaign" = '${CAMPAIGN}'`
    );
    expect(sql).toContain('limit 500');
  });

  it('includes lapsed Semester Pass (120d) buyers in the audience', () => {
    const repo = new PassWinbackRepository(pg);
    const sql = repo.buildExpiredPassBuyersQuery(CAMPAIGN, 500).toString();

    expect(sql).toContain('120d');
    expect(sql).toContain(`"user_passes"."kind" in ('24h', '7d', '120d')`);
  });

  it('scopes the already-notified exclusion to the given campaign', () => {
    const repo = new PassWinbackRepository(pg);
    const sql = repo
      .buildExpiredPassBuyersQuery('winback-2027-spring', 10)
      .toString();

    expect(sql).toContain(
      `"pass_winback_notifications"."campaign" = 'winback-2027-spring'`
    );
  });
});

describe('InMemoryPassWinbackRepository', () => {
  it('claims a notification once and rejects a duplicate for the same campaign', async () => {
    const repo = new InMemoryPassWinbackRepository();

    const first = await repo.claimNotification(42, CAMPAIGN, 'token-a');
    const second = await repo.claimNotification(42, CAMPAIGN, 'token-b');

    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('allows the same user in a different campaign', async () => {
    const repo = new InMemoryPassWinbackRepository();

    await repo.claimNotification(42, CAMPAIGN, 'token-a');
    const other = await repo.claimNotification(
      42,
      'winback-2027-spring',
      'token-b'
    );

    expect(other).toBe(true);
  });

  it('excludes buyers already claimed for the campaign from the cohort', async () => {
    const repo = new InMemoryPassWinbackRepository();
    repo.seedBuyers([
      { id: 1, name: 'A', email: 'a@example.com' },
      { id: 2, name: 'B', email: 'b@example.com' },
    ]);
    repo.seedClaim(1, CAMPAIGN, 'token-a');

    const cohort = await repo.getExpiredPassBuyers(CAMPAIGN, 500);

    expect(cohort.map((buyer) => buyer.id)).toEqual([2]);
  });

  it('resolves a claim token back to its user for unsubscribe', async () => {
    const repo = new InMemoryPassWinbackRepository();
    await repo.claimNotification(77, CAMPAIGN, 'token-x');

    const resolved = await repo.findByToken('token-x');

    expect(resolved).toEqual({ id: expect.any(Number), userId: 77 });
  });

  it('returns null for an unknown token', async () => {
    const repo = new InMemoryPassWinbackRepository();

    expect(await repo.findByToken('ghost')).toBeNull();
  });
});
