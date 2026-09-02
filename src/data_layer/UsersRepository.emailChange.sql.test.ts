import knex from 'knex';

import UsersRepository from './UsersRepository';

describe('UsersRepository email-change relink SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new UsersRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('relinks subscriptions matched by payer or linked email, lowercased', () => {
    const { sql, bindings } = repository
      .relinkSubscriptionsForEmailChangeQuery(
        pg,
        'OLD@Example.com',
        'New@Example.com'
      )
      .toSQL();

    expect(sql).toBe(
      'update "subscriptions" set "linked_email" = ? ' +
        'where LOWER(email) = ? OR LOWER(linked_email) = ?'
    );
    expect(bindings).toEqual([
      'new@example.com',
      'old@example.com',
      'old@example.com',
    ]);
  });
});
