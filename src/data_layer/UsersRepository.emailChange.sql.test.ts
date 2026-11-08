import knex from 'knex';

import UsersRepository from './UsersRepository';

describe('UsersRepository email-change relink SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new UsersRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('relinks the rows the old address receives, lowercased', () => {
    const { sql, bindings } = repository
      .relinkSubscriptionsForEmailChangeQuery(
        pg,
        'OLD@Example.com',
        'New@Example.com'
      )
      .toSQL();

    expect(sql).toBe(
      'update "subscriptions" set "linked_email" = ? ' +
        'where LOWER(linked_email) = ? OR (LOWER(email) = ? AND linked_email IS NULL)'
    );
    expect(bindings).toEqual([
      'new@example.com',
      'old@example.com',
      'old@example.com',
    ]);
  });
});
