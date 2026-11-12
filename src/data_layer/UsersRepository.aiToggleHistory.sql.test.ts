import knex from 'knex';

import UsersRepository from './UsersRepository';

describe('UsersRepository AI toggle history generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new UsersRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it("reads only the account's own AI toggle events, newest first", () => {
    const { sql, bindings } = repository
      .buildLatestAiToggleEventQuery(7)
      .toSQL();

    expect(sql).toBe(
      'select "name" from "events" where "user_id" = ? and "name" in (?, ?) order by "created_at" desc, "id" desc limit ?'
    );
    expect(bindings).toEqual([
      7,
      'upload_ai_turned_on',
      'upload_ai_turned_off',
      1,
    ]);
  });
});
