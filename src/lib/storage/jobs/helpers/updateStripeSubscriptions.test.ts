import { vi, type Mock, type MockInstance } from 'vitest';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

const mockStripeInstance = vi.hoisted(() => ({
  subscriptions: {
    list: vi.fn(),
  },
  customers: {
    retrieve: vi.fn(),
  },
}));

const mockDbInstance = vi.hoisted(() => ({
  table: vi.fn(),
}));

const mockIsDeveloperTierProduct = vi.hoisted(() =>
  vi.fn().mockResolvedValue(false)
);
vi.mock('../../../integrations/stripe', async () => {
  const actual = await vi.importActual<
    typeof import('../../../integrations/stripe')
  >('../../../integrations/stripe');
  return {
    getStripe: () => mockStripeInstance,
    extractProductId: actual.extractProductId,
    isDeveloperTierProduct: (...args: unknown[]) =>
      mockIsDeveloperTierProduct(...args),
  };
});

const mockUpsertDeveloperSubscription = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined)
);
vi.mock('../../../../data_layer/DeveloperSubscriptionsRepository', () => ({
  DeveloperSubscriptionsRepository: vi.fn().mockImplementation(function () {
    return {
      upsert: mockUpsertDeveloperSubscription,
    };
  }),
}));

vi.mock('../../../../data_layer', () => ({
  getDatabase: () => mockDbInstance,
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

type Spies = {
  insertSpy: Mock;
  updateSubscriptionSpy: Mock;
  updateUsersSpy: Mock;
};

function setupDbMock(existingRow: Record<string, unknown> | null): Spies {
  const insertSpy = vi.fn().mockResolvedValue([1]);
  const updateSubscriptionSpy = vi.fn().mockResolvedValue(1);
  const updateUsersSpy = vi.fn().mockResolvedValue(1);

  mockDbInstance.table.mockImplementation(function (tableName: string) {
    if (tableName === 'subscriptions') {
      return {
        where: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(existingRow),
          update: updateSubscriptionSpy,
        }),
        insert: insertSpy,
      };
    }
    if (tableName === 'users') {
      return {
        where: vi.fn().mockReturnValue({
          update: updateUsersSpy,
        }),
      };
    }
    return {
      where: vi.fn().mockReturnThis(),
      update: vi.fn(),
      insert: vi.fn(),
    };
  });

  return { insertSpy, updateSubscriptionSpy, updateUsersSpy };
}

function setupStripeMock(subscriptions: StripeTypes.Subscription[]) {
  mockStripeInstance.subscriptions.list.mockResolvedValue({
    data: subscriptions,
    has_more: false,
  });
  mockStripeInstance.customers.retrieve.mockResolvedValue({
    id: 'cus_test456',
    email: 'user@example.com',
    object: 'customer',
  });
}

describe('updateStripeSubscriptions — batch provisioning fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDeveloperTierProduct.mockResolvedValue(false);
  });

  it('keeps a developer tier out of the email-keyed subscriptions table', async () => {
    // The ops Sync button reaches this path directly. Without the check, one
    // press writes every developer tier back into subscriptions and re-creates
    // the collapse the separate table exists to prevent.
    mockIsDeveloperTierProduct.mockResolvedValue(true);
    const { insertSpy, updateSubscriptionSpy } = setupDbMock(null);
    setupStripeMock([buildSubscription('prod_starter')]);

    await updateStripeSubscriptions();

    expect(mockUpsertDeveloperSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ stripeProductId: 'prod_starter' })
    );
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSubscriptionSpy).not.toHaveBeenCalled();
  });

  it('inserts stripe_product_id when creating a new subscription row', async () => {
    const { insertSpy } = setupDbMock(null);
    setupStripeMock([buildSubscription('prod_autoSync789')]);
    await updateStripeSubscriptions();
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_product_id: 'prod_autoSync789' })
    );
  });

  it('updates stripe_product_id when updating an existing subscription row', async () => {
    const { updateSubscriptionSpy } = setupDbMock({
      email: 'user@example.com',
      active: true,
      payload: '{}',
    });
    setupStripeMock([buildSubscription('prod_autoSync789')]);
    await updateStripeSubscriptions();
    expect(updateSubscriptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_product_id: 'prod_autoSync789' })
    );
  });

  it('stamps updated_at when a subscription changes active status', async () => {
    const { updateSubscriptionSpy } = setupDbMock({
      email: 'user@example.com',
      active: false,
      payload: '{}',
    });
    setupStripeMock([buildSubscription('prod_autoSync789')]);
    await updateStripeSubscriptions();
    expect(updateSubscriptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, updated_at: expect.any(Date) })
    );
  });

  it('stamps updated_at when a subscription is refreshed without a status change', async () => {
    const { updateSubscriptionSpy } = setupDbMock({
      email: 'user@example.com',
      active: true,
      payload: '{}',
    });
    setupStripeMock([buildSubscription('prod_autoSync789')]);
    await updateStripeSubscriptions();
    expect(updateSubscriptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ updated_at: expect.any(Date) })
    );
  });

  it('backfills users.stripe_customer_id for a new subscription', async () => {
    const { updateUsersSpy } = setupDbMock(null);
    setupStripeMock([buildSubscription()]);
    await updateStripeSubscriptions();
    expect(updateUsersSpy).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_customer_id: 'cus_test456' })
    );
  });

  it('backfills users.stripe_customer_id when updating an existing subscription', async () => {
    const { updateUsersSpy } = setupDbMock({
      email: 'user@example.com',
      active: true,
      payload: '{}',
    });
    setupStripeMock([buildSubscription()]);
    await updateStripeSubscriptions();
    expect(updateUsersSpy).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_customer_id: 'cus_test456' })
    );
  });

  it('inserts stripe_product_id as null when product is absent from subscription', async () => {
    const { insertSpy } = setupDbMock(null);
    setupStripeMock([buildSubscription(null)]);
    await updateStripeSubscriptions();
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ stripe_product_id: null })
    );
  });
});

describe('updateStripeSubscriptions — does not log raw email or customer id', () => {
  let infoSpy: MockInstance;
  let warnSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
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

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function flatArgs(spy: MockInstance): string {
    return spy.mock.calls
      .flat()
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' | ');
  }

  it('does not interpolate the raw email when creating a new subscription', async () => {
    setupDbMock(null);
    setupStripeMock([buildSubscription()]);
    await updateStripeSubscriptions();
    expect(flatArgs(infoSpy)).not.toContain('@');
    expect(flatArgs(infoSpy)).not.toContain('cus_test456');
  });

  it('does not interpolate the raw email when updating an existing subscription (status unchanged)', async () => {
    setupDbMock({ email: 'user@example.com', active: true, payload: '{}' });
    setupStripeMock([buildSubscription()]);
    await updateStripeSubscriptions();
    expect(flatArgs(infoSpy)).not.toContain('@');
  });

  it('does not interpolate the raw email when updating an existing subscription (status changed)', async () => {
    setupDbMock({ email: 'user@example.com', active: false, payload: '{}' });
    setupStripeMock([buildSubscription()]);
    await updateStripeSubscriptions();
    expect(flatArgs(infoSpy)).not.toContain('@');
  });

  it('does not interpolate the raw email for a scheduled-cancellation subscription still inside the paid window', async () => {
    setupDbMock({ email: 'user@example.com', active: true, payload: '{}' });
    const futureUnix = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
    setupStripeMock([
      buildSubscription(undefined, {
        cancel_at_period_end: true,
        cancel_at: futureUnix,
      }),
    ]);
    await updateStripeSubscriptions();
    expect(flatArgs(infoSpy)).not.toContain('@');
  });

  it('does not interpolate the raw email or customer id when a customer has no email', async () => {
    setupDbMock(null);
    mockStripeInstance.subscriptions.list.mockResolvedValue({
      data: [buildSubscription()],
      has_more: false,
    });
    mockStripeInstance.customers.retrieve.mockResolvedValue({
      id: 'cus_test456',
      email: null,
      object: 'customer',
    });
    await updateStripeSubscriptions();
    expect(flatArgs(warnSpy)).not.toContain('cus_test456');
  });

  it('does not interpolate the raw email or customer id when the per-subscription update path errors', async () => {
    const failingDb = {
      table: vi.fn().mockImplementation(function (tableName: string) {
        if (tableName === 'subscriptions') {
          return {
            where: vi.fn().mockReturnValue({
              first: vi.fn().mockRejectedValue(new Error('db boom')),
              update: vi.fn(),
            }),
            insert: vi.fn(),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          update: vi.fn(),
          insert: vi.fn(),
        };
      }),
    };
    mockDbInstance.table.mockImplementation(failingDb.table);
    setupStripeMock([buildSubscription()]);
    await updateStripeSubscriptions();
    expect(flatArgs(errorSpy)).not.toContain('@');
    expect(flatArgs(errorSpy)).not.toContain('cus_test456');
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
