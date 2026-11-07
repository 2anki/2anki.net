process.env.STRIPE_KEY = 'sk_test_fake_key_for_unit_tests';

import knexLib, { Knex } from 'knex';
import type StripeTypes from 'stripe';

import { updateStoreSubscription } from './stripe';

const PAYER = 'payer@example.com';

const customer = {
  id: 'cus_1',
  email: PAYER,
  object: 'customer',
} as unknown as StripeTypes.Customer;

const plan = (id: string, status: string, productId: string) =>
  ({
    id,
    status,
    cancel_at_period_end: false,
    cancel_at: null,
    customer: 'cus_1',
    metadata: {},
    pause_collection: null,
    items: { data: [{ price: { product: productId } }] },
  }) as unknown as StripeTypes.Subscription;

describe('two live plans sharing one subscription row', () => {
  let db: Knex;

  const row = () => db('subscriptions').where({ email: PAYER }).first();

  beforeEach(async () => {
    db = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('users', (t) => {
      t.increments('id');
      t.string('email');
      t.string('stripe_customer_id');
      t.boolean('email_verified').defaultTo(true);
      t.text('created_at');
    });
    await db.schema.createTable('subscriptions', (t) => {
      t.increments('id');
      t.string('email').unique();
      t.boolean('active');
      t.json('payload');
      t.string('stripe_product_id');
      t.string('linked_email');
      t.text('created_at');
      t.timestamp('updated_at');
    });
    await db.schema.createTable('developer_tiers', (t) => {
      t.increments('id');
      t.string('stripe_product_id');
    });
    await db('users').insert({ id: 1, email: PAYER });
    await updateStoreSubscription(
      db,
      customer,
      plan('sub_auto_sync', 'active', 'prod_auto_sync')
    );
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('keeps access when the old plan goes past due', async () => {
    await updateStoreSubscription(
      db,
      customer,
      plan('sub_pro', 'past_due', 'prod_pro')
    );

    const stored = await row();
    expect(Boolean(stored.active)).toBe(true);
    expect(stored.stripe_product_id).toBe('prod_auto_sync');
  });

  it('keeps access when the old plan is cancelled', async () => {
    await updateStoreSubscription(
      db,
      customer,
      plan('sub_pro', 'canceled', 'prod_pro')
    );

    expect(Boolean((await row()).active)).toBe(true);
  });

  it('turns access off when the plan the row holds goes past due', async () => {
    await updateStoreSubscription(
      db,
      customer,
      plan('sub_auto_sync', 'past_due', 'prod_auto_sync')
    );

    expect(Boolean((await row()).active)).toBe(false);
  });

  it('lets a newly active plan take over the row', async () => {
    await updateStoreSubscription(
      db,
      customer,
      plan('sub_new', 'active', 'prod_pro')
    );

    expect((await row()).stripe_product_id).toBe('prod_pro');
  });

  it('records a lapsed plan on an ended row', async () => {
    await db('subscriptions').where({ email: PAYER }).update({ active: false });

    await updateStoreSubscription(
      db,
      customer,
      plan('sub_pro', 'past_due', 'prod_pro')
    );

    expect((await row()).stripe_product_id).toBe('prod_pro');
  });
});
