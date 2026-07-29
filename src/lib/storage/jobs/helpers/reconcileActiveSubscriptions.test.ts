import knexLib, { Knex } from 'knex';

import {
  reconcileActiveSubscriptions,
  reconcileDeveloperSubscriptions,
} from './reconcileActiveSubscriptions';

type DbMock = jest.Mock & { updateSpy: jest.Mock };

function buildDbMock(
  activeRows: Array<{ id: number; email: string; payload: unknown }>
): DbMock {
  const updateSpy = jest.fn().mockResolvedValue(1);

  const db = jest.fn().mockImplementation((table: string) => {
    const rows = table === 'subscriptions_developer' ? [] : activeRows;
    const builder: Record<string, unknown> = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      update: updateSpy,
      then: (resolve: (value: unknown) => void) => resolve(rows),
    };
    return builder;
  }) as DbMock;
  db.updateSpy = updateSpy;
  return db;
}

function buildStripeMock(retrieveImpl: (id: string) => Promise<any>) {
  return {
    subscriptions: {
      retrieve: jest.fn().mockImplementation(retrieveImpl),
    },
  } as any;
}

describe('reconcileActiveSubscriptions', () => {
  it('flips DB row inactive when Stripe no longer reports the sub as active', async () => {
    const db = buildDbMock([
      { id: 1, email: 'user@example.com', payload: { id: 'sub_1' } },
    ]);
    const stripe = buildStripeMock(async () => ({
      id: 'sub_1',
      status: 'canceled',
    }));

    await reconcileActiveSubscriptions(db as any, stripe);

    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_1');
    expect(db.updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, updated_at: expect.any(Date) })
    );
  });

  it('leaves DB row alone when Stripe still reports the sub as active', async () => {
    const db = buildDbMock([
      { id: 1, email: 'user@example.com', payload: { id: 'sub_1' } },
    ]);
    const stripe = buildStripeMock(async () => ({
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: false,
    }));

    await reconcileActiveSubscriptions(db as any, stripe);

    expect(db.updateSpy).not.toHaveBeenCalled();
  });

  it('flips DB row inactive for scheduled-cancel subs past their period end', async () => {
    const pastSeconds = Math.floor(Date.now() / 1000) - 60;
    const db = buildDbMock([
      { id: 1, email: 'user@example.com', payload: { id: 'sub_1' } },
    ]);
    const stripe = buildStripeMock(async () => ({
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: true,
      cancel_at: pastSeconds,
    }));

    await reconcileActiveSubscriptions(db as any, stripe);

    expect(db.updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, updated_at: expect.any(Date) })
    );
  });

  it('flips DB row inactive when Stripe returns 404 for the sub', async () => {
    const db = buildDbMock([
      { id: 1, email: 'user@example.com', payload: { id: 'sub_missing' } },
    ]);
    const stripe = {
      subscriptions: {
        retrieve: jest.fn().mockRejectedValue({
          statusCode: 404,
          message: 'No such subscription',
        }),
      },
    } as any;

    await reconcileActiveSubscriptions(db as any, stripe);

    expect(db.updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, updated_at: expect.any(Date) })
    );
  });

  it('skips rows with missing or malformed payload without throwing', async () => {
    const db = buildDbMock([
      { id: 1, email: 'a@example.com', payload: null },
      { id: 2, email: 'b@example.com', payload: 'not-json' },
    ]);
    const stripe = buildStripeMock(async () => ({ status: 'canceled' }));

    await expect(
      reconcileActiveSubscriptions(db as any, stripe)
    ).resolves.toBeUndefined();

    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(db.updateSpy).not.toHaveBeenCalled();
  });

  it('does not throw when a single Stripe lookup fails; continues to next row', async () => {
    const db = buildDbMock([
      { id: 1, email: 'a@example.com', payload: { id: 'sub_1' } },
      { id: 2, email: 'b@example.com', payload: { id: 'sub_2' } },
    ]);
    const retrieve = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: 'canceled' });
    const stripe = { subscriptions: { retrieve } } as any;

    await reconcileActiveSubscriptions(db as any, stripe);

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(db.updateSpy).toHaveBeenCalledTimes(1);
  });
});

describe('reconcileDeveloperSubscriptions', () => {
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

  async function insertRow(
    stripeSubscriptionId: string,
    active: boolean
  ): Promise<void> {
    await db('subscriptions_developer').insert({
      stripe_subscription_id: stripeSubscriptionId,
      user_id: 7,
      email: 'dev@example.com',
      stripe_product_id: 'prod_starter',
      active,
      payload: JSON.stringify({ id: stripeSubscriptionId }),
    });
  }

  async function activeFlag(stripeSubscriptionId: string): Promise<boolean> {
    const row = await db('subscriptions_developer')
      .where({ stripe_subscription_id: stripeSubscriptionId })
      .first();
    return Boolean(row.active);
  }

  it('flips an active row inactive when Stripe reports the sub as canceled', async () => {
    await insertRow('sub_dev_1', true);
    const stripe = buildStripeMock(async () => ({
      id: 'sub_dev_1',
      status: 'canceled',
    }));

    await reconcileDeveloperSubscriptions(db, stripe);

    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_dev_1');
    expect(await activeFlag('sub_dev_1')).toBe(false);
  });

  it('flips an active row inactive when Stripe returns 404 for the sub', async () => {
    await insertRow('sub_dev_missing', true);
    const stripe = {
      subscriptions: {
        retrieve: jest.fn().mockRejectedValue({
          statusCode: 404,
          message: 'No such subscription',
        }),
      },
    } as any;

    await reconcileDeveloperSubscriptions(db, stripe);

    expect(await activeFlag('sub_dev_missing')).toBe(false);
  });

  it('flips an active row inactive when Stripe reports the sub as paused', async () => {
    await insertRow('sub_dev_paused', true);
    const stripe = buildStripeMock(async () => ({
      id: 'sub_dev_paused',
      status: 'active',
      pause_collection: { behavior: 'void' },
    }));

    await reconcileDeveloperSubscriptions(db, stripe);

    expect(await activeFlag('sub_dev_paused')).toBe(false);
  });

  it('leaves an active row alone when Stripe still reports the sub as active', async () => {
    await insertRow('sub_dev_2', true);
    const stripe = buildStripeMock(async () => ({
      id: 'sub_dev_2',
      status: 'active',
      cancel_at_period_end: false,
    }));

    await reconcileDeveloperSubscriptions(db, stripe);

    expect(await activeFlag('sub_dev_2')).toBe(true);
  });

  it('does not abort the sweep when one Stripe lookup fails; still reconciles the rest', async () => {
    await insertRow('sub_dev_boom', true);
    await insertRow('sub_dev_ok', true);
    const retrieve = jest.fn().mockImplementation(async (id: string) => {
      if (id === 'sub_dev_boom') {
        throw new Error('boom');
      }
      return { id, status: 'canceled' };
    });
    const stripe = { subscriptions: { retrieve } } as any;

    await reconcileDeveloperSubscriptions(db, stripe);

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(await activeFlag('sub_dev_boom')).toBe(true);
    expect(await activeFlag('sub_dev_ok')).toBe(false);
  });
});
