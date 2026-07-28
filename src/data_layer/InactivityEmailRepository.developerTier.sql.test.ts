import knexFactory from 'knex';

import { InactivityEmailRepository } from './InactivityEmailRepository';

// Developer tiers live in subscriptions_developer (#3902), not subscriptions,
// so the subscriber guards on these queries do not see them. Without the
// exemption a customer whose only paid subscription is a developer tier is
// treated as a free inactive user: warned, then deleted outright.
describe('InactivityEmailRepository developer-tier exemption SQL', () => {
  const pg = knexFactory({ client: 'pg' });
  const repository = new InactivityEmailRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('exempts an active developer tier from the warning query', () => {
    const sql = repository.buildUsersToNotifyQuery(500).toString();

    expect(sql).toContain('"subscriptions_developer"');
    expect(sql).toContain('subscriptions_developer.user_id = users.id');
    expect(sql).toContain('subscriptions_developer.email = users.email');
  });

  it('exempts an active developer tier from the deletion query', () => {
    const sql = repository.buildUsersToDeleteQuery(100).toString();

    expect(sql).toContain('"subscriptions_developer"');
    expect(sql).toContain('subscriptions_developer.user_id = u.id');
  });

  it('exempts an active developer tier from the dead-address candidate query', () => {
    const sql = repository.buildDeadAddressCandidatesQuery(100).toString();

    expect(sql).toContain('"subscriptions_developer"');
    expect(sql).toContain('subscriptions_developer.user_id = u.id');
  });

  it('only exempts while the developer subscription is active', () => {
    const sql = repository.buildUsersToDeleteQuery(100).toString();

    expect(sql).toContain('"subscriptions_developer"."active" = true');
  });
});
