import { vi, type Mock } from 'vitest';
import knex, { Knex } from 'knex';

vi.mock('../data_layer', () => ({ getDatabase: vi.fn() }));
vi.mock('../lib/integrations/stripe', () => ({ getStripe: vi.fn() }));
vi.mock('./EmailService/EmailService', () => ({
  getDefaultEmailService: vi.fn(() => ({
    sendSubscriptionCancelledEmail: vi.fn(),
    sendSubscriptionScheduledCancellationEmail: vi.fn(),
  })),
}));

import { getDatabase } from '../data_layer';
import { getStripe } from '../lib/integrations/stripe';
import SubscriptionService, {
  SubscriptionNotOwnedError,
} from './SubscriptionService';

const PAYER = 'payer@example.com';
const OWNER = 'owner@example.com';
const SUBSCRIBED = '2026-02-01T00:00:00.000Z';
const AFTER = '2026-03-01T00:00:00.000Z';

const liveSubscription = {
  id: 'sub_1',
  status: 'active',
  cancel_at: null,
  cancel_at_period_end: false,
};

describe('SubscriptionService and an address the account has not proven', () => {
  let database: Knex;
  let stripe: {
    customers: { list: Mock; search: Mock };
    subscriptions: { list: Mock; update: Mock; cancel: Mock };
  };

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await database.schema.createTable('subscriptions', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
      t.text('linked_email').nullable();
      t.boolean('active').notNullable().defaultTo(false);
      t.text('stripe_product_id').nullable();
      t.text('payload').nullable();
      t.text('created_at').nullable();
      t.text('updated_at').nullable();
    });
    await database.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
      t.boolean('email_verified').notNullable().defaultTo(false);
      t.text('created_at').nullable();
    });
    await database('subscriptions').insert({
      email: PAYER,
      linked_email: OWNER,
      active: true,
      stripe_product_id: 'prod_auto_sync',
      payload: JSON.stringify({ id: 'sub_1', metadata: {} }),
      created_at: SUBSCRIBED,
    });
    await database('users').insert([
      { email: OWNER, email_verified: false, created_at: SUBSCRIBED },
      { email: PAYER, email_verified: false, created_at: AFTER },
    ]);

    stripe = {
      customers: {
        list: vi.fn().mockResolvedValue({ data: [{ id: 'cus_1' }] }),
        search: vi.fn().mockResolvedValue({ data: [] }),
      },
      subscriptions: {
        list: vi.fn().mockResolvedValue({ data: [liveSubscription] }),
        update: vi.fn().mockResolvedValue(liveSubscription),
        cancel: vi.fn().mockResolvedValue(liveSubscription),
      },
    };
    (getDatabase as Mock).mockReturnValue(database);
    (getStripe as Mock).mockReturnValue(stripe);
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('gives the unproven account no subscription rows', async () => {
    const rows = await SubscriptionService.getUserActiveSubscriptions(PAYER);

    expect(rows).toEqual([]);
  });

  it('keeps the row for the linked owner', async () => {
    const rows = await SubscriptionService.getUserActiveSubscriptions(OWNER);

    expect(rows).toMatchObject([{ email: PAYER, linked_email: OWNER }]);
  });

  it('gives the row to the payer account once it is verified', async () => {
    await database('users')
      .where({ email: PAYER })
      .update({ email_verified: true });

    const rows = await SubscriptionService.getUserActiveSubscriptions(PAYER);

    expect(rows).toMatchObject([{ email: PAYER }]);
  });

  it('never reaches Stripe for the unproven account', async () => {
    const subs = await SubscriptionService.findRecentStripeSubscriptions(PAYER);

    expect(subs).toEqual([]);
    expect(stripe.customers.list).not.toHaveBeenCalled();
  });

  it('still lists the plan for the linked owner', async () => {
    const subs = await SubscriptionService.findActiveStripeSubscriptions(OWNER);

    expect(subs).toEqual([liveSubscription]);
    expect(stripe.customers.list).toHaveBeenCalledWith({
      email: PAYER,
      limit: 10,
    });
  });

  it('does not let the unproven account cancel the plan', async () => {
    const applied = await SubscriptionService.cancelUserSubscriptions(PAYER);

    expect(applied).toEqual([]);
    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });

  it('does not let the unproven account cancel the plan by id', async () => {
    await expect(
      SubscriptionService.cancelSubscriptionById(PAYER, 'sub_1')
    ).rejects.toBeInstanceOf(SubscriptionNotOwnedError);

    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('does not let the unproven account pause the plan', async () => {
    await expect(
      SubscriptionService.pauseSubscription(PAYER, 1)
    ).rejects.toBeInstanceOf(SubscriptionNotOwnedError);

    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('does not let the unproven account resume the plan', async () => {
    stripe.subscriptions.list.mockResolvedValue({
      data: [
        {
          ...liveSubscription,
          pause_collection: { behavior: 'void', resumes_at: 1_900_000_000 },
        },
      ],
    });

    await expect(
      SubscriptionService.resumeSubscription(PAYER)
    ).rejects.toBeInstanceOf(SubscriptionNotOwnedError);

    expect(stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('stays closed after a checkout of its own rewrites the row', async () => {
    const account = await database('users').where({ email: PAYER }).first();
    await database('subscriptions')
      .where({ email: PAYER })
      .update({
        payload: JSON.stringify({
          id: 'sub_2',
          metadata: { user_id: String(account.id) },
        }),
      });

    const rows = await SubscriptionService.getUserActiveSubscriptions(PAYER);
    const subs = await SubscriptionService.findRecentStripeSubscriptions(PAYER);

    expect(rows).toEqual([]);
    expect(subs).toEqual([]);
  });

  it('keeps Stripe closed to an unverified account with no row', async () => {
    await database('subscriptions').where({ email: PAYER }).del();

    const subs = await SubscriptionService.findRecentStripeSubscriptions(PAYER);

    expect(subs).toEqual([]);
    expect(stripe.customers.list).not.toHaveBeenCalled();
  });

  it('lets ops end every live plan on a typed address', async () => {
    const applied =
      await SubscriptionService.cancelEverySubscriptionAtAddress(PAYER);

    expect(applied).toEqual(['immediate']);
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1');
  });

  it('lets the claim flow find the plan of a submitted address', async () => {
    const subs =
      await SubscriptionService.findActiveStripeSubscriptionsForAddress(PAYER);

    expect(subs).toEqual([liveSubscription]);
  });
});
