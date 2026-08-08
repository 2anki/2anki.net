import knex from 'knex';

import { buildNewSubscriptionsQuery } from './PaidValueSubscriptionsRepository';

const since = new Date('2026-07-07T12:00:00.000Z');
const until = new Date('2026-07-14T12:00:00.000Z');

describe('PaidValueSubscriptionsRepository generated SQL', () => {
  const pg = knex({ client: 'pg' });

  afterAll(async () => {
    await pg.destroy();
  });

  it('joins subscriptions to users by normalized email and filters by created_at window', () => {
    const { sql, bindings } = buildNewSubscriptionsQuery(
      pg,
      since,
      until
    ).toSQL();

    expect(sql).toBe(
      'select "users"."id" as "user_id", ' +
        '"subscriptions"."created_at" as "created_at" from "subscriptions" ' +
        'join users on lower(trim(users.email)) = lower(trim(subscriptions.email)) ' +
        'where "subscriptions"."created_at" >= ? and "subscriptions"."created_at" <= ?'
    );
    expect(bindings).toEqual([since, until]);
  });
});
