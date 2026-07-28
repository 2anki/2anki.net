import knexLib, { Knex } from 'knex';

import { DeveloperSubscriptionsRepository } from './DeveloperSubscriptionsRepository';

describe('DeveloperSubscriptionsRepository', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('subscriptions_developer', (t) => {
      t.increments('id');
      t.string('stripe_subscription_id').unique();
      t.integer('user_id');
      t.string('email');
      t.string('stripe_product_id');
      t.boolean('active');
      t.json('payload');
      t.timestamp('updated_at');
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  function repo() {
    return new DeveloperSubscriptionsRepository(db);
  }

  const base = {
    userId: 7,
    email: 'dev@example.com',
    stripeProductId: 'prod_starter',
    active: true,
    payload: { id: 'sub_1' },
  };

  it('keeps two concurrent tiers as two rows', async () => {
    await repo().upsert({ ...base, stripeSubscriptionId: 'sub_1' });
    await repo().upsert({
      ...base,
      stripeSubscriptionId: 'sub_2',
      stripeProductId: 'prod_growth',
    });

    expect(await repo().activeProductIdsForUser(7)).toEqual(
      expect.arrayContaining(['prod_starter', 'prod_growth'])
    );
  });

  it('updates in place when the same subscription is seen again', async () => {
    await repo().upsert({ ...base, stripeSubscriptionId: 'sub_1' });
    await repo().upsert({
      ...base,
      stripeSubscriptionId: 'sub_1',
      active: false,
    });

    const rows = await db('subscriptions_developer').select('*');
    expect(rows).toHaveLength(1);
    expect(Boolean(rows[0].active)).toBe(false);
  });

  it('omits an inactive tier from the resolved product ids', async () => {
    await repo().upsert({
      ...base,
      stripeSubscriptionId: 'sub_1',
      active: false,
    });
    expect(await repo().activeProductIdsForUser(7)).toEqual([]);
  });

  it('finds a subscription paid under an unlinked Stripe email', async () => {
    await repo().upsert({
      ...base,
      stripeSubscriptionId: 'sub_1',
      userId: null,
    });

    expect(await repo().activeProductIdsForUser(7)).toEqual([]);
    expect(await repo().activeProductIdsForEmail('  DEV@Example.com ')).toEqual(
      ['prod_starter']
    );
  });

  it('does not leak another account’s tier through the email lookup', async () => {
    await repo().upsert({
      ...base,
      stripeSubscriptionId: 'sub_1',
      userId: null,
      email: 'someone-else@example.com',
    });

    expect(await repo().activeProductIdsForEmail('dev@example.com')).toEqual(
      []
    );
  });
});
