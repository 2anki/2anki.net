import knex from 'knex';

import UsersRepository from './UsersRepository';

describe('UsersRepository email-change relink SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new UsersRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('relinks the rows whose recipient is the old address, lowercased', () => {
    const { sql, bindings } = repository
      .relinkSubscriptionsForEmailChangeQuery(
        pg,
        ' OLD@Example.com ',
        'New@Example.com'
      )
      .toSQL();

    expect(sql).toBe(
      'update "subscriptions" set "linked_email" = ? ' +
        'where (lower(linked_email) = ? or ' +
        '("linked_email" is null and lower(email) = ?))'
    );
    expect(bindings).toEqual([
      'new@example.com',
      'old@example.com',
      'old@example.com',
    ]);
  });
});
