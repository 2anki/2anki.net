process.env.STRIPE_KEY = 'sk_test_fake_key_for_unit_tests';

import knexLib, { Knex } from 'knex';
import type StripeTypes from 'stripe';

import {
  deactivateSubscriptionRow,
  resolveAccountForSubscription,
  updateStoreSubscription,
} from './stripe';

const PAYER = 'payer@example.com';
const OWNER = 'owner@example.com';
const CUSTOMER = 'cus_payer';

const customer = {
  id: CUSTOMER,
  email: PAYER,
  object: 'customer',
} as unknown as StripeTypes.Customer;

const subscription = {
  id: 'sub_1',
  status: 'active',
  cancel_at_period_end: false,
  cancel_at: null,
  customer: CUSTOMER,
  metadata: {},
  pause_collection: null,
  items: { data: [{ price: { product: 'prod_pro' } }] },
} as unknown as StripeTypes.Subscription;

describe('a Stripe event for a payer address held by an unverified account', () => {
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
      t.boolean('email_verified').defaultTo(false);
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
    await db('users').insert([
      { id: 1, email: OWNER, created_at: '2026-01-01T00:00:00.000Z' },
      { id: 2, email: PAYER, created_at: '2026-03-01T00:00:00.000Z' },
    ]);
    await db('subscriptions').insert({
      email: PAYER,
      active: true,
      linked_email: OWNER,
      payload: JSON.stringify({ id: 'sub_1', metadata: {} }),
      created_at: '2026-02-01T00:00:00.000Z',
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('resolves to the linked owner, not the account on the address', async () => {
    const account = await resolveAccountForSubscription(
      db,
      subscription,
      CUSTOMER,
      PAYER
    );

    expect(account).toEqual({ id: 1, email: OWNER });
  });

  it('stamps the customer on the owner and leaves the unverified account bare', async () => {
    const result = await updateStoreSubscription(db, customer, subscription);

    const stamped = await db('users')
      .whereNotNull('stripe_customer_id')
      .select('id');
    expect(result.resolvedUserId).toBe(1);
    expect(stamped).toEqual([{ id: 1 }]);
  });

  it('ends the row of a plan that ended with no account resolved', async () => {
    await deactivateSubscriptionRow(db, {
      ...subscription,
      status: 'canceled',
    } as StripeTypes.Subscription);

    const row = await db('subscriptions').where({ email: PAYER }).first();
    expect(Boolean(row.active)).toBe(false);
    expect(JSON.parse(row.payload)).toMatchObject({ status: 'canceled' });
  });

  it('leaves a newer plan on the row alone', async () => {
    await deactivateSubscriptionRow(db, {
      ...subscription,
      id: 'sub_older',
    } as StripeTypes.Subscription);

    const row = await db('subscriptions').where({ email: PAYER }).first();
    expect(Boolean(row.active)).toBe(true);
  });

  it('clears a link left by an earlier plan when the account buys on its own address', async () => {
    await db('users').where({ id: 2 }).update({ email_verified: true });

    await updateStoreSubscription(db, customer, {
      ...subscription,
      metadata: { user_id: '2' },
    } as unknown as StripeTypes.Subscription);

    const row = await db('subscriptions').where({ email: PAYER }).first();
    expect(row.linked_email).toBeNull();
  });

  it('keeps the link when the account did not buy this plan', async () => {
    await db('users').where({ id: 2 }).update({ email_verified: true });

    await updateStoreSubscription(db, customer, subscription);

    const row = await db('subscriptions').where({ email: PAYER }).first();
    expect(row.linked_email).toBe(OWNER);
  });

  it('resolves to a verified account on the address as before', async () => {
    await db('users').where({ id: 2 }).update({ email_verified: true });

    const account = await resolveAccountForSubscription(
      db,
      subscription,
      CUSTOMER,
      PAYER
    );

    expect(account).toEqual({ id: 2, email: PAYER });
  });
});
