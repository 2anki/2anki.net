import knexFactory from 'knex';

import { InactivityEmailRepository } from './InactivityEmailRepository';

describe('InactivityEmailRepository paid access SQL', () => {
  const pg = knexFactory({ client: 'pg' });
  const repository = new InactivityEmailRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it.each([
    [
      'warning',
      () => repository.buildUsersToNotifyQuery(500).toString(),
      'users',
    ],
    [
      'deletion after a warning',
      () => repository.buildUsersToDeleteQuery(100).toString(),
      'u',
    ],
  ])(
    'leaves lifetime and paying users out of the %s query',
    (_label, buildSql, user) => {
      const sql = buildSql();

      expect(sql).toContain(`${user}.patreon IS NOT TRUE`);
      expect(sql).toContain(
        `not exists (select * from "subscriptions" where "subscriptions"."active" = true and (subscriptions.email = ${user}.email OR subscriptions.linked_email = ${user}.email)`
      );
    }
  );
});
