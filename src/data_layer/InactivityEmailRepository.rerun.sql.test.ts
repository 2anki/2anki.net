import knexFactory from 'knex';

import { InactivityEmailRepository } from './InactivityEmailRepository';

describe('InactivityEmailRepository rerun safety SQL', () => {
  const pg = knexFactory({ client: 'pg' });
  const repository = new InactivityEmailRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('leaves out every user who already has a warning row', () => {
    const sql = repository.buildUsersToNotifyQuery(500).toString();

    expect(sql).toContain(
      'not exists (select * from "inactivity_emails" where inactivity_emails.user_id = users.id limit 1)'
    );
  });

  it('only selects deletion candidates whose users row still exists', () => {
    const sql = repository.buildUsersToDeleteQuery(100).toString();

    expect(sql).toContain(
      'inner join "users" as "u" on "u"."id" = "ie"."user_id"'
    );
  });
});
