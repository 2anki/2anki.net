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

  it('never resolves a tier for a row with no user_id', async () => {
    await repo().upsert({
      ...base,
      stripeSubscriptionId: 'sub_1',
      userId: null,
    });

    // The row exists, is active, and carries an email — and still grants
    // nothing. Matching on that email would hand the tier to whoever registers
    // the address, since registration does not verify it.
    expect(await repo().activeProductIdsForUser(7)).toEqual([]);
  });

  it('deactivates by subscription id without needing an account', async () => {
    await repo().upsert({
      ...base,
      stripeSubscriptionId: 'sub_1',
      userId: null,
    });

    expect(await repo().deactivateBySubscriptionId('sub_1')).toBe(1);
    const row = await db('subscriptions_developer').first();
    expect(Boolean(row.active)).toBe(false);
  });

  it('leaves other subscriptions alone when deactivating one', async () => {
    await repo().upsert({ ...base, stripeSubscriptionId: 'sub_1' });
    await repo().upsert({
      ...base,
      stripeSubscriptionId: 'sub_2',
      stripeProductId: 'prod_growth',
    });

    await repo().deactivateBySubscriptionId('sub_1');
    expect(await repo().activeProductIdsForUser(7)).toEqual(['prod_growth']);
  });
});
