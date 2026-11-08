process.env.STRIPE_KEY = 'sk_test_fake_key_for_unit_tests';

import knexLib, { Knex } from 'knex';
import { vi } from 'vitest';

import { getStripe } from '../../lib/integrations/stripe';
import { PersistStripeSessionUseCase } from './PersistStripeSessionUseCase';

const PAYER = 'payer@example.com';
const AUTO_SYNC = 'prod_auto_sync';

const plan = (id: string, productId: string) => ({
  id,
  status: 'active',
  cancel_at_period_end: false,
  cancel_at: null,
  customer: 'cus_1',
  metadata: {},
  pause_collection: null,
  items: { data: [{ price: { product: productId } }] },
});

describe('PersistStripeSessionUseCase', () => {
  let db: Knex;
  const retrieveHeld = vi.spyOn(getStripe().subscriptions, 'retrieve');

  const persist = (session: unknown, subscription: unknown) =>
    new PersistStripeSessionUseCase(
      {
        checkout: {
          sessions: { retrieve: vi.fn().mockResolvedValue(session) },
        },
        subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
        customers: {
          retrieve: vi.fn().mockResolvedValue({ id: 'cus_1', email: PAYER }),
        },
      } as never,
      db
    ).execute('cs_1');

  beforeEach(async () => {
    process.env.AUTO_SYNC_PRODUCT_ID = AUTO_SYNC;
    retrieveHeld.mockReset();
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
  });

  afterEach(async () => {
    delete process.env.AUTO_SYNC_PRODUCT_ID;
    await db.destroy();
  });

  it('saves a paid session plan', async () => {
    const saved = await persist(
      { payment_status: 'paid', subscription: 'sub_new' },
      plan('sub_new', 'prod_pro')
    );

    expect(saved).toBe(true);
    const row = await db('subscriptions').where({ email: PAYER }).first();
    expect(row.stripe_product_id).toBe('prod_pro');
  });

  it('saves nothing for an unpaid session', async () => {
    const saved = await persist(
      { payment_status: 'unpaid', subscription: 'sub_new' },
      plan('sub_new', 'prod_pro')
    );

    expect(saved).toBe(false);
    expect(await db('subscriptions').where({ email: PAYER })).toEqual([]);
  });

  it('keeps a live Auto Sync plan on the row', async () => {
    await db('subscriptions').insert({
      email: PAYER,
      active: true,
      payload: JSON.stringify(plan('sub_auto_sync', AUTO_SYNC)),
      stripe_product_id: AUTO_SYNC,
    });
    retrieveHeld.mockResolvedValue(plan('sub_auto_sync', AUTO_SYNC) as never);

    await persist(
      { payment_status: 'paid', subscription: 'sub_new' },
      plan('sub_new', 'prod_pro')
    );

    const row = await db('subscriptions').where({ email: PAYER }).first();
    expect(row.stripe_product_id).toBe(AUTO_SYNC);
  });
});
