process.env.STRIPE_KEY = 'sk_test_fake_key_for_unit_tests';

import knexLib, { Knex } from 'knex';
import { isDeveloperTierProduct, updateStoreSubscription } from './stripe';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

const makeCustomer = (
  email: string | null,
  id = 'cus_test123'
): StripeTypes.Customer =>
  ({ email, id, object: 'customer' }) as unknown as StripeTypes.Customer;

const makeSubscription = (
  status: StripeTypes.Subscription['status'],
  productId: string,
  options: {
    customer?: string;
    cancelAtPeriodEnd?: boolean;
    cancelAt?: number | null;
    userId?: string;
    pauseCollection?: { behavior: string; resumes_at: number } | null;
  } = {}
): StripeTypes.Subscription =>
  ({
    status,
    cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
    cancel_at: options.cancelAt ?? null,
    customer: options.customer ?? 'cus_test123',
    metadata: options.userId != null ? { user_id: options.userId } : {},
    pause_collection: options.pauseCollection ?? null,
    items: { data: [{ price: { product: productId } }] },
  }) as unknown as StripeTypes.Subscription;

describe('updateStoreSubscription', () => {
  let db: Knex;

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
    });
    await db.schema.createTable('subscriptions', (t) => {
      t.increments('id');
      t.string('email').unique();
      t.boolean('active');
      t.json('payload');
      t.string('stripe_product_id');
      t.string('linked_email');
    });
    await db.schema.createTable('developer_tiers', (t) => {
      t.increments('id');
      t.string('tier_key');
      t.string('stripe_product_id');
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

  test('inserts the subscription row with the extracted product id and active flag', async () => {
    await db('users').insert({
      email: 'user@example.com',
      stripe_customer_id: null,
    });

    const result = await updateStoreSubscription(
      db,
      makeCustomer('user@example.com'),
      makeSubscription('active', 'prod_auto_sync')
    );

    const row = await db('subscriptions')
      .where({ email: 'user@example.com' })
      .first();
    expect(row.stripe_product_id).toBe('prod_auto_sync');
    expect(Boolean(row.active)).toBe(true);
    expect(result).toEqual({ status: 'linked', resolvedUserId: 1 });
  });

  test('marks active=false when subscription status is canceled', async () => {
    await db('users').insert({ email: 'user@example.com' });

    await updateStoreSubscription(
      db,
      makeCustomer('user@example.com'),
      makeSubscription('canceled', 'prod_auto_sync')
    );

    const row = await db('subscriptions')
      .where({ email: 'user@example.com' })
      .first();
    expect(Boolean(row.active)).toBe(false);
  });

  test('marks active=false when the subscription is paused despite active status', async () => {
    await db('users').insert({ email: 'user@example.com' });

    await updateStoreSubscription(
      db,
      makeCustomer('user@example.com'),
      makeSubscription('active', 'prod_auto_sync', {
        pauseCollection: { behavior: 'void', resumes_at: 1893456000 },
      })
    );

    const row = await db('subscriptions')
      .where({ email: 'user@example.com' })
      .first();
    expect(Boolean(row.active)).toBe(false);
  });

  test('keeps active=true during dunning when status is past_due', async () => {
    await db('users').insert({ email: 'user@example.com' });

    await updateStoreSubscription(
      db,
      makeCustomer('user@example.com'),
      makeSubscription('past_due', 'prod_auto_sync')
    );

    const row = await db('subscriptions')
      .where({ email: 'user@example.com' })
      .first();
    expect(Boolean(row.active)).toBe(true);
  });

  test('keeps active=true during dunning when status is unpaid', async () => {
    await db('users').insert({ email: 'user@example.com' });

    await updateStoreSubscription(
      db,
      makeCustomer('user@example.com'),
      makeSubscription('unpaid', 'prod_auto_sync')
    );

    const row = await db('subscriptions')
      .where({ email: 'user@example.com' })
      .first();
    expect(Boolean(row.active)).toBe(true);
  });

  test('marks active=false when a past_due subscription is also paused', async () => {
    await db('users').insert({ email: 'user@example.com' });

    await updateStoreSubscription(
      db,
      makeCustomer('user@example.com'),
      makeSubscription('past_due', 'prod_auto_sync', {
        pauseCollection: { behavior: 'void', resumes_at: 1893456000 },
      })
    );

    const row = await db('subscriptions')
      .where({ email: 'user@example.com' })
      .first();
    expect(Boolean(row.active)).toBe(false);
  });

  test('marks active=false for a never-paid incomplete subscription', async () => {
    await db('users').insert({ email: 'user@example.com' });

    await updateStoreSubscription(
      db,
      makeCustomer('user@example.com'),
      makeSubscription('incomplete', 'prod_auto_sync')
    );

    const row = await db('subscriptions')
      .where({ email: 'user@example.com' })
      .first();
    expect(Boolean(row.active)).toBe(false);
  });

  test('links by metadata.user_id even when the Stripe email differs from the account', async () => {
    await db('users').insert({
      email: 'account@example.com',
      stripe_customer_id: null,
    });

    const result = await updateStoreSubscription(
      db,
      makeCustomer('paid-with@example.com'),
      makeSubscription('active', 'prod_auto_sync', { userId: '1' })
    );

    expect(result).toEqual({ status: 'linked', resolvedUserId: 1 });
    const user = await db('users').where({ id: 1 }).first();
    expect(user.stripe_customer_id).toBe('cus_test123');
    const row = await db('subscriptions')
      .where({ email: 'paid-with@example.com' })
      .first();
    expect(row.linked_email).toBe('account@example.com');
  });

  test('links by stripe_customer_id when no metadata is present', async () => {
    await db('users').insert({
      email: 'account@example.com',
      stripe_customer_id: 'cus_test123',
    });

    const result = await updateStoreSubscription(
      db,
      makeCustomer('different@example.com'),
      makeSubscription('active', 'prod_auto_sync')
    );

    expect(result.status).toBe('linked');
    const row = await db('subscriptions')
      .where({ email: 'different@example.com' })
      .first();
    expect(row.linked_email).toBe('account@example.com');
  });

  test('links by email and leaves linked_email null when emails match', async () => {
    await db('users').insert({ email: 'user@example.com' });

    const result = await updateStoreSubscription(
      db,
      makeCustomer('User@Example.com'),
      makeSubscription('active', 'prod_auto_sync')
    );

    expect(result).toEqual({ status: 'linked', resolvedUserId: 1 });
    const row = await db('subscriptions')
      .where({ email: 'user@example.com' })
      .first();
    expect(row.linked_email).toBeNull();
  });

  test('returns unlinked and fires no users update when no account matches', async () => {
    const result = await updateStoreSubscription(
      db,
      makeCustomer('nobody@example.com'),
      makeSubscription('active', 'prod_auto_sync')
    );

    expect(result).toEqual({ status: 'unlinked', resolvedUserId: null });
    const row = await db('subscriptions')
      .where({ email: 'nobody@example.com' })
      .first();
    expect(row.linked_email).toBeNull();
  });

  test('preserves an existing linked_email when a later update has matching emails', async () => {
    await db('users').insert({
      email: 'account@example.com',
      stripe_customer_id: 'cus_test123',
    });
    await db('subscriptions').insert({
      email: 'paid-with@example.com',
      active: true,
      payload: '{}',
      stripe_product_id: 'prod_auto_sync',
      linked_email: 'account@example.com',
    });

    await updateStoreSubscription(
      db,
      makeCustomer('paid-with@example.com'),
      makeSubscription('active', 'prod_auto_sync', { customer: 'cus_test123' })
    );

    const row = await db('subscriptions')
      .where({ email: 'paid-with@example.com' })
      .first();
    expect(row.linked_email).toBe('account@example.com');
  });
});

describe('updateStoreSubscription linked_email resolution', () => {
  let db: Knex;

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
    });
    await db.schema.createTable('subscriptions', (t) => {
      t.increments('id');
      t.string('email').unique();
      t.boolean('active');
      t.json('payload');
      t.string('stripe_product_id');
      t.string('linked_email');
    });
    await db.schema.createTable('developer_tiers', (t) => {
      t.increments('id');
      t.string('tier_key');
      t.string('stripe_product_id');
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

  test('resolves a manually reconciled sub through subscriptions.linked_email and backfills the customer id', async () => {
    await db('users').insert({
      email: 'account@example.com',
      stripe_customer_id: null,
    });
    await db('subscriptions').insert({
      email: 'old-stripe@example.com',
      active: true,
      payload: '{}',
      stripe_product_id: 'prod_legacy',
      linked_email: 'account@example.com',
    });

    const result = await updateStoreSubscription(
      db,
      makeCustomer('old-stripe@example.com', 'cus_legacy1'),
      makeSubscription('active', 'prod_legacy', { customer: 'cus_legacy1' })
    );

    expect(result.status).toBe('linked');
    const user = await db('users')
      .where({ email: 'account@example.com' })
      .first();
    expect(user.stripe_customer_id).toBe('cus_legacy1');
    const sub = await db('subscriptions')
      .where({ email: 'old-stripe@example.com' })
      .first();
    expect(sub.linked_email).toBe('account@example.com');
  });

  test("does not borrow another subscription row's linked_email", async () => {
    await db('users').insert({
      email: 'other-account@example.com',
      stripe_customer_id: null,
    });
    await db('subscriptions').insert({
      email: 'someone-else@example.com',
      active: true,
      payload: '{}',
      stripe_product_id: 'prod_legacy',
      linked_email: 'other-account@example.com',
    });

    const result = await updateStoreSubscription(
      db,
      makeCustomer('stranger@example.com', 'cus_stranger'),
      makeSubscription('active', 'prod_legacy', { customer: 'cus_stranger' })
    );

    expect(result.status).toBe('unlinked');
    const user = await db('users')
      .where({ email: 'other-account@example.com' })
      .first();
    expect(user.stripe_customer_id).toBeNull();
  });
});

describe('updateStoreSubscription developer tiers', () => {
  let db: Knex;

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
    });
    await db.schema.createTable('subscriptions', (t) => {
      t.increments('id');
      t.string('email').unique();
      t.boolean('active');
      t.json('payload');
      t.string('stripe_product_id');
      t.string('linked_email');
    });
    await db.schema.createTable('developer_tiers', (t) => {
      t.increments('id');
      t.string('tier_key');
      t.string('stripe_product_id');
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
    await db('developer_tiers').insert([
      { tier_key: 'starter', stripe_product_id: 'prod_starter' },
      { tier_key: 'growth', stripe_product_id: 'prod_growth' },
    ]);
  });

  afterEach(async () => {
    await db.destroy();
  });

  const customer = { id: 'cus_dev', email: 'dev@example.com' } as never;

  function sub(id: string, productId: string, status = 'active') {
    return {
      id,
      status,
      customer: 'cus_dev',
      items: { data: [{ price: { product: productId } }] },
    } as never;
  }

  test('a developer tier never touches the base subscriptions table', async () => {
    await updateStoreSubscription(db, customer, sub('sub_a', 'prod_starter'));

    expect(await db('subscriptions').select('*')).toHaveLength(0);
    const rows = await db('subscriptions_developer').select('*');
    expect(rows).toHaveLength(1);
    expect(rows[0].stripe_product_id).toBe('prod_starter');
  });

  test('a base plan and a developer tier coexist instead of overwriting', async () => {
    await updateStoreSubscription(db, customer, sub('sub_base', 'prod_base'));
    await updateStoreSubscription(db, customer, sub('sub_dev', 'prod_growth'));

    const base = await db('subscriptions').select('*');
    expect(base).toHaveLength(1);
    expect(base[0].stripe_product_id).toBe('prod_base');
    expect(Boolean(base[0].active)).toBe(true);

    const dev = await db('subscriptions_developer').select('*');
    expect(dev).toHaveLength(1);
    expect(dev[0].stripe_product_id).toBe('prod_growth');
  });

  test('two concurrent developer tiers are two rows, not one overwriting the other', async () => {
    await updateStoreSubscription(db, customer, sub('sub_1', 'prod_starter'));
    await updateStoreSubscription(db, customer, sub('sub_2', 'prod_growth'));

    const rows = await db('subscriptions_developer')
      .select('stripe_product_id')
      .orderBy('stripe_product_id');
    expect(rows.map((r) => r.stripe_product_id)).toEqual([
      'prod_growth',
      'prod_starter',
    ]);
  });

  test('cancelling the developer tier leaves the base plan active', async () => {
    await updateStoreSubscription(db, customer, sub('sub_base', 'prod_base'));
    await updateStoreSubscription(db, customer, sub('sub_dev', 'prod_starter'));
    await updateStoreSubscription(
      db,
      customer,
      sub('sub_dev', 'prod_starter', 'canceled')
    );

    const base = await db('subscriptions').first();
    expect(Boolean(base.active)).toBe(true);

    const dev = await db('subscriptions_developer').first();
    expect(Boolean(dev.active)).toBe(false);
  });

  test('the same developer subscription updating twice stays one row', async () => {
    await updateStoreSubscription(db, customer, sub('sub_1', 'prod_starter'));
    await updateStoreSubscription(
      db,
      customer,
      sub('sub_1', 'prod_starter', 'past_due')
    );

    expect(await db('subscriptions_developer').select('*')).toHaveLength(1);
  });

  // Exported so the ops sync path can apply the identical check; it writes to
  // subscriptions directly and would otherwise re-create the collapse on one
  // press of the Sync button.
  test('identifies developer tier products from the developer_tiers table', async () => {
    expect(await isDeveloperTierProduct(db, 'prod_starter')).toBe(true);
    expect(await isDeveloperTierProduct(db, 'prod_growth')).toBe(true);
    expect(await isDeveloperTierProduct(db, 'prod_base')).toBe(false);
  });
});
