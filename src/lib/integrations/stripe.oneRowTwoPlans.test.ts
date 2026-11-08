process.env.STRIPE_KEY = 'sk_test_fake_key_for_unit_tests';

import knexLib, { Knex } from 'knex';
import type StripeTypes from 'stripe';
import { vi } from 'vitest';

import { getStripe, updateStoreSubscription } from './stripe';

const PAYER = 'payer@example.com';
const AUTO_SYNC = 'prod_auto_sync';
const PRO = 'prod_pro';

const customer = {
  id: 'cus_1',
  email: PAYER,
  object: 'customer',
} as unknown as StripeTypes.Customer;

const plan = (
  id: string,
  status: string,
  productId: string,
  extra: Record<string, unknown> = {}
) =>
  ({
    id,
    status,
    cancel_at_period_end: false,
    cancel_at: null,
    customer: 'cus_1',
    metadata: {},
    pause_collection: null,
    items: { data: [{ price: { product: productId } }] },
    ...extra,
  }) as unknown as StripeTypes.Subscription;

describe('two plans sharing one subscription row', () => {
  let db: Knex;
  let stripePlans: Map<string, StripeTypes.Subscription>;
  const retrieve = vi.spyOn(getStripe().subscriptions, 'retrieve');
  const list = vi.spyOn(getStripe().subscriptions, 'list');

  const row = () => db('subscriptions').where({ email: PAYER }).first();
  const heldId = async () => JSON.parse((await row()).payload).id;
  const receive = (subscription: StripeTypes.Subscription) =>
    updateStoreSubscription(db, customer, subscription);
  const stripeHolds = (subscription: StripeTypes.Subscription) => {
    stripePlans.set(subscription.id, subscription);
    return subscription;
  };

  beforeEach(async () => {
    process.env.AUTO_SYNC_PRODUCT_ID = AUTO_SYNC;
    stripePlans = new Map();
    retrieve.mockReset();
    retrieve.mockImplementation((async (id: string) => {
      const found = stripePlans.get(id);
      if (found == null) {
        throw Object.assign(new Error('gone'), { code: 'resource_missing' });
      }
      return found;
    }) as never);
    list.mockReset();
    list.mockImplementation((async (params: {
      customer: string;
      status: string;
    }) => ({
      data: [...stripePlans.values()].filter(
        (candidate) =>
          candidate.customer === params.customer &&
          candidate.status === params.status
      ),
    })) as never);
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
    await receive(stripeHolds(plan('sub_auto_sync', 'active', AUTO_SYNC)));
  });

  afterEach(async () => {
    delete process.env.AUTO_SYNC_PRODUCT_ID;
    await db.destroy();
  });

  describe('when another plan stops', () => {
    it.each(['past_due', 'canceled'])(
      'keeps the live plan when the old one reads %s',
      async (status) => {
        await receive(plan('sub_pro', status, PRO));

        const stored = await row();
        expect(Boolean(stored.active)).toBe(true);
        expect(stored.stripe_product_id).toBe(AUTO_SYNC);
        expect(await heldId()).toBe('sub_auto_sync');
      }
    );

    it('leaves the customer on the account alone', async () => {
      await receive(plan('sub_pro', 'canceled', PRO, { customer: 'cus_old' }));

      const account = await db('users').where({ id: 1 }).first();
      expect(account.stripe_customer_id).toBe('cus_1');
    });

    it('answers unlinked for a payer with no account', async () => {
      await db('users').where({ id: 1 }).delete();

      const result = await receive(plan('sub_pro', 'canceled', PRO));

      expect(result).toEqual({ status: 'unlinked', resolvedUserId: null });
      expect(Boolean((await row()).active)).toBe(true);
    });

    it.each([
      ['cancelled', plan('sub_auto_sync', 'canceled', AUTO_SYNC)],
      ['unpaid', plan('sub_auto_sync', 'past_due', AUTO_SYNC)],
      [
        'paused',
        plan('sub_auto_sync', 'active', AUTO_SYNC, {
          pause_collection: { behavior: 'void' },
        }),
      ],
    ])(
      'ends the row when Stripe says the held plan is %s',
      async (_state, held) => {
        stripeHolds(held);

        await receive(plan('sub_pro', 'canceled', PRO));

        const stored = await row();
        expect(Boolean(stored.active)).toBe(false);
        expect(await heldId()).toBe('sub_pro');
      }
    );

    it('ends the row when Stripe no longer has the held plan', async () => {
      stripePlans.clear();

      await receive(plan('sub_pro', 'canceled', PRO));

      expect(Boolean((await row()).active)).toBe(false);
    });

    it('leaves the row as it was when Stripe cannot answer', async () => {
      retrieve.mockRejectedValue(new Error('rate limited'));

      await expect(receive(plan('sub_pro', 'canceled', PRO))).rejects.toThrow();

      const stored = await row();
      expect(Boolean(stored.active)).toBe(true);
      expect(await heldId()).toBe('sub_auto_sync');
    });

    it('ends access after a late event left a dead plan on the row', async () => {
      await db('subscriptions')
        .where({ email: PAYER })
        .update({
          payload: JSON.stringify(plan('sub_a', 'active', PRO)),
          stripe_product_id: PRO,
        });
      stripeHolds(plan('sub_a', 'canceled', PRO));

      await receive(plan('sub_b', 'canceled', 'prod_other'));

      expect(Boolean((await row()).active)).toBe(false);
    });
  });

  describe('when the plan the row holds stops', () => {
    it.each(['past_due', 'canceled'])(
      'turns access off on %s',
      async (status) => {
        await receive(plan('sub_auto_sync', status, AUTO_SYNC));

        expect(Boolean((await row()).active)).toBe(false);
        expect(retrieve).not.toHaveBeenCalled();
      }
    );

    const holdOnRow = (subscription: StripeTypes.Subscription) =>
      db('subscriptions')
        .where({ email: PAYER })
        .update({
          payload: JSON.stringify(subscription),
          stripe_product_id: subscription.items.data[0].price.product,
        });
    const paidUntil = (end: number) => ({
      items: { data: [{ price: { product: PRO }, current_period_end: end }] },
    });

    it.each([
      ['canceled', plan('sub_auto_sync', 'canceled', AUTO_SYNC)],
      ['past due', plan('sub_auto_sync', 'past_due', AUTO_SYNC)],
      [
        'paused',
        plan('sub_auto_sync', 'active', AUTO_SYNC, {
          pause_collection: { behavior: 'void' },
        }),
      ],
      [
        'past its scheduled cancellation',
        plan('sub_auto_sync', 'active', AUTO_SYNC, {
          cancel_at_period_end: true,
          cancel_at: 1_000_000_000,
        }),
      ],
    ])(
      'hands the row to the plan still running when the held one is %s',
      async (_state, held) => {
        stripeHolds(plan('sub_pro', 'active', PRO));
        const ended = stripeHolds(held);

        await receive(ended);

        const stored = await row();
        expect(Boolean(stored.active)).toBe(true);
        expect(stored.stripe_product_id).toBe(PRO);
        expect(await heldId()).toBe('sub_pro');
      }
    );

    it('ends the row when the customer vanishes before its plans are listed', async () => {
      stripeHolds(plan('sub_pro', 'active', PRO));
      list.mockRejectedValue(
        Object.assign(new Error('No such customer'), {
          code: 'resource_missing',
        })
      );

      await receive(plan('sub_auto_sync', 'canceled', AUTO_SYNC));

      expect(list).toHaveBeenCalled();
      expect(Boolean((await row()).active)).toBe(false);
    });

    it('hands the row over after an in-app cancel already turned it off', async () => {
      stripeHolds(plan('sub_pro', 'active', PRO));
      const ended = stripeHolds(plan('sub_auto_sync', 'canceled', AUTO_SYNC));
      await db('subscriptions')
        .where({ email: PAYER })
        .update({ active: false, payload: JSON.stringify(ended) });

      await receive(ended);

      const stored = await row();
      expect(Boolean(stored.active)).toBe(true);
      expect(await heldId()).toBe('sub_pro');
    });

    it('hands the row over for a payer with no account', async () => {
      await db('users').where({ id: 1 }).delete();
      stripeHolds(plan('sub_pro', 'active', PRO));
      const ended = stripeHolds(plan('sub_auto_sync', 'canceled', AUTO_SYNC));

      const result = await receive(ended);

      expect(result).toEqual({ status: 'unlinked', resolvedUserId: null });
      expect(Boolean((await row()).active)).toBe(true);
      expect(await heldId()).toBe('sub_pro');
    });

    it('skips a paused plan when choosing who takes the row', async () => {
      await holdOnRow(plan('sub_pro_a', 'active', PRO));
      stripeHolds(
        plan('sub_auto_sync', 'active', AUTO_SYNC, {
          pause_collection: { behavior: 'void' },
        })
      );
      stripeHolds(plan('sub_pro_b', 'active', PRO, paidUntil(2_000_000_000)));

      await receive(plan('sub_pro_a', 'canceled', PRO));

      expect(Boolean((await row()).active)).toBe(true);
      expect(await heldId()).toBe('sub_pro_b');
    });

    it('hands the row by payment date alone when no Auto Sync product is set', async () => {
      delete process.env.AUTO_SYNC_PRODUCT_ID;
      await holdOnRow(plan('sub_pro_a', 'active', PRO));
      stripeHolds(plan('sub_pro_b', 'active', PRO, paidUntil(2_000_000_000)));

      await receive(plan('sub_pro_a', 'canceled', PRO));

      expect(await heldId()).toBe('sub_pro_b');
    });

    it('hands the row to Auto Sync before a plan paid further ahead', async () => {
      await holdOnRow(plan('sub_pro_a', 'active', PRO));
      stripeHolds(plan('sub_pro_b', 'active', PRO, paidUntil(2_000_000_000)));

      await receive(plan('sub_pro_a', 'canceled', PRO));

      expect((await row()).stripe_product_id).toBe(AUTO_SYNC);
      expect(await heldId()).toBe('sub_auto_sync');
    });

    it('hands the row to the plan paid furthest ahead when no Auto Sync runs', async () => {
      stripeHolds(plan('sub_auto_sync', 'canceled', AUTO_SYNC));
      await holdOnRow(plan('sub_pro_a', 'active', PRO));
      stripeHolds(plan('sub_pro_b', 'active', PRO, paidUntil(1_900_000_000)));
      stripeHolds(plan('sub_pro_c', 'active', PRO, paidUntil(2_000_000_000)));

      await receive(plan('sub_pro_a', 'canceled', PRO));

      expect(Boolean((await row()).active)).toBe(true);
      expect(await heldId()).toBe('sub_pro_c');
    });

    it('does not hand the row to a developer tier', async () => {
      await db('developer_tiers').insert({ stripe_product_id: 'prod_dev' });
      stripeHolds(plan('sub_dev', 'active', 'prod_dev'));

      await receive(plan('sub_auto_sync', 'canceled', AUTO_SYNC));

      expect(list).toHaveBeenCalled();
      expect(Boolean((await row()).active)).toBe(false);
    });

    it('leaves the row as it was when Stripe cannot list the plans', async () => {
      list.mockRejectedValue(new Error('rate limited'));

      await expect(
        receive(plan('sub_auto_sync', 'canceled', AUTO_SYNC))
      ).rejects.toThrow();

      expect(Boolean((await row()).active)).toBe(true);
    });
  });

  describe('when another plan runs', () => {
    it.each([
      ['recovers from a failed payment', plan('sub_pro', 'active', PRO)],
      ['resumes after a pause', plan('sub_paused', 'active', PRO)],
    ])('keeps Auto Sync when an old plan %s', async (_case, incoming) => {
      await receive(incoming);

      const stored = await row();
      expect(Boolean(stored.active)).toBe(true);
      expect(stored.stripe_product_id).toBe(AUTO_SYNC);
      expect(await heldId()).toBe('sub_auto_sync');
    });

    it('keeps Auto Sync when the old plan then fails again', async () => {
      await receive(plan('sub_pro', 'active', PRO));
      await receive(plan('sub_pro', 'past_due', PRO));

      expect(Boolean((await row()).active)).toBe(true);
    });

    it('still records the account the event names', async () => {
      await db('users').insert({ id: 2, email: 'owner@example.com' });

      await receive(
        plan('sub_pro', 'active', PRO, { metadata: { user_id: '2' } })
      );

      const stored = await row();
      expect(stored.linked_email).toBe('owner@example.com');
      expect(stored.stripe_product_id).toBe(AUTO_SYNC);
    });

    it('takes the row once Stripe says Auto Sync has ended', async () => {
      stripeHolds(plan('sub_auto_sync', 'canceled', AUTO_SYNC));

      await receive(plan('sub_pro', 'active', PRO));

      expect((await row()).stripe_product_id).toBe(PRO);
    });

    it('lets Auto Sync take the row from Pro', async () => {
      await db('subscriptions')
        .where({ email: PAYER })
        .update({
          payload: JSON.stringify(plan('sub_pro', 'active', PRO)),
          stripe_product_id: PRO,
        });

      await receive(plan('sub_new', 'active', AUTO_SYNC));

      expect((await row()).stripe_product_id).toBe(AUTO_SYNC);
      expect(retrieve).not.toHaveBeenCalled();
    });

    it('lets a newer plan take a row that holds Pro', async () => {
      await db('subscriptions')
        .where({ email: PAYER })
        .update({
          payload: JSON.stringify(plan('sub_pro', 'active', PRO)),
          stripe_product_id: PRO,
        });

      await receive(plan('sub_new', 'active', 'prod_other'));

      expect((await row()).stripe_product_id).toBe('prod_other');
      expect(retrieve).not.toHaveBeenCalled();
    });
  });

  it('lets another plan take the row when no Auto Sync product is set', async () => {
    delete process.env.AUTO_SYNC_PRODUCT_ID;

    await receive(plan('sub_pro', 'active', PRO));

    expect((await row()).stripe_product_id).toBe(PRO);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('records a lapsed plan on an ended row', async () => {
    await db('subscriptions').where({ email: PAYER }).update({ active: false });

    await receive(plan('sub_pro', 'past_due', PRO));

    expect((await row()).stripe_product_id).toBe(PRO);
    expect(retrieve).not.toHaveBeenCalled();
  });
});
