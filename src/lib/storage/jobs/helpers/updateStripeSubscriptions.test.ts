import { vi, type MockInstance } from 'vitest';
import knexLib, { type Knex } from 'knex';
import type StripeTypes from 'stripe';

const mockStripeInstance = vi.hoisted(() => ({
  subscriptions: {
    list: vi.fn(),
  },
  customers: {
    retrieve: vi.fn(),
  },
}));

// The real shared writer runs; only the Stripe client is faked.
vi.mock('../../../integrations/stripe', async () => {
  const actual = await vi.importActual<
    typeof import('../../../integrations/stripe')
  >('../../../integrations/stripe');
  return { ...actual, getStripe: () => mockStripeInstance };
});

vi.mock('../../../../data_layer', () => ({
  getDatabase: () => ({}),
}));

vi.mock('./reconcileActiveSubscriptions', () => ({
  reconcileActiveSubscriptions: vi.fn().mockResolvedValue(undefined),
}));

import {
  updateStripeSubscriptions,
  mapWithConcurrency,
} from './updateStripeSubscriptions';

function buildSubscription(
  productId: string | null | undefined = 'prod_autoSync789',
  overrides: Partial<StripeTypes.Subscription> = {}
): StripeTypes.Subscription {
  return {
    id: 'sub_test123',
    status: 'active',
    cancel_at_period_end: false,
    cancel_at: null,
    customer: 'cus_test456',
    metadata: {},
    pause_collection: null,
    items: {
      data: [
        {
          price: { product: productId } as StripeTypes.Price,
        } as StripeTypes.SubscriptionItem,
      ],
      object: 'list',
      has_more: false,
      url: '',
    },
    ...overrides,
  } as unknown as StripeTypes.Subscription;
}

function setupStripeMock(
  subscriptions: StripeTypes.Subscription[],
  email: string | null = 'user@example.com'
) {
  mockStripeInstance.subscriptions.list.mockResolvedValue({
    data: subscriptions,
    has_more: false,
  });
  mockStripeInstance.customers.retrieve.mockResolvedValue({
    id: 'cus_test456',
    email,
    object: 'customer',
  });
}

async function buildDatabase(): Promise<Knex> {
  const db = knexLib({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await db.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('email');
    t.string('stripe_customer_id').unique();
  });
  await db.schema.createTable('subscriptions', (t) => {
    t.increments('id');
    t.string('email').unique();
    t.boolean('active');
    t.json('payload');
    t.string('stripe_product_id');
    t.string('linked_email').unique();
    t.timestamp('created_at');
    t.timestamp('updated_at');
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
  return db;
}

describe('updateStripeSubscriptions writes through the webhook path', () => {
  let db: Knex;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await buildDatabase();
  });

  afterEach(async () => {
    await db.destroy();
  });

  const row = (email = 'user@example.com') =>
    db('subscriptions').where({ email }).first();

  it('marks a paused subscription inactive, as the webhook does', async () => {
    await db('subscriptions').insert({
      email: 'user@example.com',
      active: true,
      payload: '{}',
    });
    setupStripeMock([
      buildSubscription(undefined, {
        pause_collection: {
          behavior: 'void',
          resumes_at: null,
        } as unknown as StripeTypes.Subscription.PauseCollection,
      }),
    ]);

    await updateStripeSubscriptions(db);

    expect(Boolean((await row()).active)).toBe(false);
  });

  it('keeps an active subscription active and records its product id', async () => {
    setupStripeMock([buildSubscription()]);

    await updateStripeSubscriptions(db);

    expect(await row()).toMatchObject({
      stripe_product_id: 'prod_autoSync789',
    });
    expect(Boolean((await row()).active)).toBe(true);
  });

  it.each([
    ['still inside the paid period', 30, true],
    ['past the end of the paid period', -1, false],
  ])(
    'treats a subscription set to cancel at period end and %s as active=%s',
    async (_when, days, expected) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
      const cancelAt =
        Math.floor(new Date('2026-10-29T12:00:00Z').getTime() / 1000) +
        days * 24 * 60 * 60;
      setupStripeMock([
        buildSubscription(undefined, {
          cancel_at_period_end: true,
          cancel_at: cancelAt,
        }),
      ]);

      await updateStripeSubscriptions(db).finally(() => vi.useRealTimers());

      expect(Boolean((await row()).active)).toBe(expected);
    }
  );

  // The sync used to write such a row unlinked, which cancelUnlinkedSubscriptions
  // would then cancel; it now fails the row the way the webhook always has.
  it('leaves a row alone, like the webhook, when another row already links the account', async () => {
    await db('users').insert({
      email: 'owner@example.com',
      stripe_customer_id: 'cus_test456',
    });
    await db('subscriptions').insert({
      email: 'old-billing@example.com',
      active: true,
      payload: '{}',
      linked_email: 'owner@example.com',
    });
    setupStripeMock([buildSubscription()], 'new-billing@example.com');

    await updateStripeSubscriptions(db);

    expect(await row('new-billing@example.com')).toBeUndefined();
    expect(await row('old-billing@example.com')).toMatchObject({
      linked_email: 'owner@example.com',
    });
  });

  it('links a subscription paid with another email to the account that holds its customer id', async () => {
    await db('users').insert({
      email: 'owner@example.com',
      stripe_customer_id: 'cus_test456',
    });
    await db('subscriptions').insert({
      email: 'user@example.com',
      active: true,
      payload: '{}',
    });
    setupStripeMock([buildSubscription()]);

    await updateStripeSubscriptions(db);

    expect(await row()).toMatchObject({ linked_email: 'owner@example.com' });
  });

  it('keeps the linked account on a subscription paid with another email', async () => {
    await db('users').insert({
      email: 'owner@example.com',
      stripe_customer_id: 'cus_test456',
    });
    await db('subscriptions').insert({
      email: 'user@example.com',
      active: true,
      payload: '{}',
      linked_email: 'owner@example.com',
    });
    setupStripeMock([buildSubscription()]);

    await updateStripeSubscriptions(db);

    expect(await row()).toMatchObject({ linked_email: 'owner@example.com' });
  });

  it('stamps the customer id on the paying account when nobody holds it', async () => {
    await db('users').insert({ email: 'user@example.com' });
    setupStripeMock([buildSubscription()]);

    await updateStripeSubscriptions(db);

    expect(
      await db('users').where({ email: 'user@example.com' }).first()
    ).toMatchObject({ stripe_customer_id: 'cus_test456' });
  });

  it('leaves the customer id with the account that already holds it', async () => {
    await db('users').insert([
      { email: 'holder@example.com', stripe_customer_id: 'cus_test456' },
      { email: 'user@example.com', stripe_customer_id: null },
    ]);
    const payer = await db('users')
      .where({ email: 'user@example.com' })
      .first();
    setupStripeMock([
      buildSubscription(undefined, {
        metadata: { user_id: String(payer.id) },
      }),
    ]);

    await updateStripeSubscriptions(db);

    expect(
      await db('users')
        .where({ stripe_customer_id: 'cus_test456' })
        .select('email')
    ).toEqual([{ email: 'holder@example.com' }]);
    expect(Boolean((await row()).active)).toBe(true);
  });

  it('keeps a developer tier out of the email-keyed subscriptions table', async () => {
    await db('developer_tiers').insert({
      tier_key: 'starter',
      stripe_product_id: 'prod_dev_starter',
    });
    setupStripeMock([buildSubscription('prod_dev_starter')]);

    await updateStripeSubscriptions(db);

    expect(await row()).toBeUndefined();
    expect(
      await db('subscriptions_developer').select('stripe_product_id')
    ).toEqual([{ stripe_product_id: 'prod_dev_starter' }]);
  });
});

describe('updateStripeSubscriptions — does not log raw email or customer id', () => {
  let db: Knex;
  let infoSpy: MockInstance;
  let warnSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = await buildDatabase();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(function () {
      return undefined;
    });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () {
      return undefined;
    });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(function () {
      return undefined;
    });
  });

  afterEach(async () => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    await db.destroy();
  });

  function flatArgs(spy: MockInstance): string {
    return spy.mock.calls
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' | ');
  }

  it('does not log the raw email or customer id when the customer id is held elsewhere', async () => {
    await db('users').insert([
      { email: 'holder@example.com', stripe_customer_id: 'cus_test456' },
      { email: 'user@example.com', stripe_customer_id: null },
    ]);
    const payer = await db('users')
      .where({ email: 'user@example.com' })
      .first();
    setupStripeMock([
      buildSubscription(undefined, {
        metadata: { user_id: String(payer.id) },
      }),
    ]);

    await updateStripeSubscriptions(db);

    expect(flatArgs(infoSpy)).not.toContain('@');
    expect(flatArgs(infoSpy)).not.toContain('cus_test456');
  });

  it('does not log the raw email or customer id when a customer has no email', async () => {
    setupStripeMock([buildSubscription()], null);

    await updateStripeSubscriptions(db);

    expect(flatArgs(warnSpy)).not.toContain('cus_test456');
  });

  it('logs only the error class and code when Stripe cannot return the customer', async () => {
    setupStripeMock([buildSubscription()]);
    mockStripeInstance.customers.retrieve.mockRejectedValue(
      Object.assign(new Error("No such customer: 'cus_test456'"), {
        code: 'resource_missing',
      })
    );

    await updateStripeSubscriptions(db);

    const logged = errorSpy.mock.calls.flat();
    expect(logged.every((arg) => typeof arg === 'string')).toBe(true);
    expect(logged.join(' ')).not.toContain('cus_test456');
  });

  it('logs only the error class and code when the write fails', async () => {
    await db.schema.dropTable('subscriptions');
    setupStripeMock([buildSubscription()]);

    await updateStripeSubscriptions(db);

    const logged = errorSpy.mock.calls.flat();
    expect(logged.every((arg) => typeof arg === 'string')).toBe(true);
    expect(logged.join(' ')).not.toContain('@');
    expect(logged.join(' ')).not.toContain('cus_test456');
  });
});

describe('mapWithConcurrency', () => {
  it('processes every item', async () => {
    const seen: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never runs more than `concurrency` workers at once', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const worker = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    };

    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      5,
      worker
    );

    expect(maxInFlight).toBeLessThanOrEqual(5);
  });

  it('treats a non-positive concurrency as sequential', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const worker = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    };

    await mapWithConcurrency([1, 2, 3], 0, worker);

    expect(maxInFlight).toBe(1);
  });

  it('does nothing for an empty list', async () => {
    const worker = vi.fn().mockResolvedValue(undefined);
    await mapWithConcurrency([], 5, worker);
    expect(worker).not.toHaveBeenCalled();
  });
});
