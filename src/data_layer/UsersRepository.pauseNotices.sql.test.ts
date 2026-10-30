import knex from 'knex';

import UsersRepository from './UsersRepository';

describe('UsersRepository pause-resume warning notice SQL (pg dialect)', () => {
  const pg = knex({ client: 'pg' });
  const repository = new UsersRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('purges notices on the account address, and payer-keyed ones only once their resume date has passed', () => {
    const now = new Date('2026-10-30T00:00:00.000Z');
    const owned = pg('subscriptions')
      .whereRaw('lower(email) = ?', ['account@example.com'])
      .select('email');

    const { sql, bindings } = repository
      .deletePauseNoticesForAccountQuery(pg, 'account@example.com', owned, now)
      .toSQL();

    expect(sql).toBe(
      'delete from "pause_resume_warning_notices" ' +
        'where lower(subscription_email) = ? ' +
        'or ("subscription_email" in ' +
        '(select "email" from "subscriptions" where lower(email) = ?) ' +
        'and "resumes_at" < ?)'
    );
    expect(bindings).toEqual([
      'account@example.com',
      'account@example.com',
      now,
    ]);
  });

  it('forgets the notices on an address no subscription still sends to, lowercased', () => {
    const { sql, bindings } = repository
      .forgetPauseNoticesForAddressQuery(pg, ' Old@Example.com ')
      .toSQL();

    expect(sql).toBe(
      'delete from "pause_resume_warning_notices" ' +
        'where lower(subscription_email) = ? ' +
        'and not exists (select 1 from "subscriptions" ' +
        'where lower(coalesce(linked_email, email)) = ?)'
    );
    expect(bindings).toEqual(['old@example.com', 'old@example.com']);
  });
});
