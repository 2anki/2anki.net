import { vi } from 'vitest';
import knex, { Knex } from 'knex';

vi.mock('../data_layer', () => ({ getDatabase: vi.fn() }));
vi.mock('../lib/integrations/stripe', () => ({ getStripe: vi.fn() }));

import { getDatabase } from '../data_layer';
import SubscriptionService from './SubscriptionService';

const ACCOUNT = 'account@example.com';

describe('an account that receives two plans', () => {
  let database: Knex;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await database.schema.createTable('subscriptions', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable().unique();
      t.text('linked_email').nullable().index();
      t.boolean('active').notNullable().defaultTo(false);
      t.text('stripe_product_id').nullable();
      t.text('payload').nullable();
      t.text('created_at').nullable();
      t.text('updated_at').nullable();
    });
    await database.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
      t.boolean('email_verified').notNullable().defaultTo(true);
      t.text('created_at').nullable();
      t.text('stripe_customer_id').nullable();
    });
    await database('users').insert({ email: ACCOUNT });
    vi.mocked(getDatabase).mockReturnValue(database);
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('keeps access through the live plan when the ended one was linked first', async () => {
    await database('subscriptions').insert([
      {
        email: 'old-payer@example.com',
        linked_email: ACCOUNT,
        active: false,
        stripe_product_id: 'prod_pro',
      },
      {
        email: 'new-payer@example.com',
        linked_email: ACCOUNT,
        active: true,
        stripe_product_id: 'prod_auto_sync',
      },
    ]);

    const active =
      await SubscriptionService.getUserActiveSubscriptions(ACCOUNT);

    expect(active.map((row) => row.email)).toEqual(['new-payer@example.com']);
  });

  it('reads both plans when both run', async () => {
    await database('subscriptions').insert([
      {
        email: 'own@example.com',
        linked_email: ACCOUNT,
        active: true,
        stripe_product_id: 'prod_pro',
      },
      {
        email: 'gift@example.com',
        linked_email: ACCOUNT,
        active: true,
        stripe_product_id: 'prod_auto_sync',
      },
    ]);

    const active =
      await SubscriptionService.getUserActiveSubscriptions(ACCOUNT);

    expect(active.map((row) => row.stripe_product_id).sort()).toEqual([
      'prod_auto_sync',
      'prod_pro',
    ]);
  });
});
