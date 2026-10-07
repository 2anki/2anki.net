import { vi, type Mock } from 'vitest';
process.env.THE_HASHING_SECRET = 'test-hashing-secret';

import { StripeCustomerResolver } from './StripeCustomerResolver';

const makeStripe = (overrides: Record<string, Mock> = {}) => {
  const list = overrides.list ?? vi.fn().mockResolvedValue({ data: [] });
  const search = overrides.search ?? vi.fn().mockResolvedValue({ data: [] });
  const create =
    overrides.create ?? vi.fn().mockResolvedValue({ id: 'cus_created' });
  const del = overrides.del ?? vi.fn().mockResolvedValue({ deleted: true });
  return {
    stripe: { customers: { list, search, create, del } } as never,
    list,
    search,
    create,
    del,
  };
};

const makeStore = (stored: string | null, claimReturns?: string) => {
  const getStripeCustomerId = vi.fn().mockResolvedValue(stored);
  const claimStripeCustomerId = vi
    .fn()
    .mockImplementation(
      async (_id: number, candidate: string) => claimReturns ?? candidate
    );
  return { getStripeCustomerId, claimStripeCustomerId };
};

describe('StripeCustomerResolver', () => {
  it('returns the stored customer id without calling Stripe', async () => {
    const { stripe, list, search, create } = makeStripe();
    const store = makeStore('cus_stored');
    const resolver = new StripeCustomerResolver(stripe, store);

    const result = await resolver.resolveOrCreate(42, 'learner@example.test');

    expect(result).toBe('cus_stored');
    expect(store.getStripeCustomerId).toHaveBeenCalledWith(42);
    expect(list).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a new customer carrying the user id when none is stored', async () => {
    const { stripe, create } = makeStripe({
      create: vi.fn().mockResolvedValue({ id: 'cus_new' }),
    });
    const store = makeStore(null);
    const resolver = new StripeCustomerResolver(stripe, store);

    const result = await resolver.resolveOrCreate(42, 'learner@example.test');

    expect(result).toBe('cus_new');
    expect(create).toHaveBeenCalledWith({
      email: 'learner@example.test',
      metadata: { user_id: '42' },
    });
    expect(store.claimStripeCustomerId).toHaveBeenCalledWith(42, 'cus_new');
  });

  it('never looks a customer up by email: creates fresh even when a same-email customer exists', async () => {
    const { stripe, list, search, create } = makeStripe({
      list: vi.fn().mockResolvedValue({ data: [{ id: 'cus_sameemail' }] }),
      search: vi.fn().mockResolvedValue({ data: [{ id: 'cus_sameemail' }] }),
      create: vi.fn().mockResolvedValue({ id: 'cus_new' }),
    });
    const store = makeStore(null);
    const resolver = new StripeCustomerResolver(stripe, store);

    const result = await resolver.resolveOrCreate(42, 'learner@example.test');

    expect(result).toBe('cus_new');
    expect(list).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalled();
  });

  it('deletes the customer it just created when it loses the claim race', async () => {
    const { stripe, del } = makeStripe({
      create: vi.fn().mockResolvedValue({ id: 'cus_mine' }),
    });
    const store = makeStore(null, 'cus_rival');
    const resolver = new StripeCustomerResolver(stripe, store);

    const result = await resolver.resolveOrCreate(42, 'learner@example.test');

    expect(result).toBe('cus_rival');
    expect(del).toHaveBeenCalledWith('cus_mine');
  });

  it('treats an empty stored id as a miss and creates afresh', async () => {
    const { stripe, create } = makeStripe({
      create: vi.fn().mockResolvedValue({ id: 'cus_new' }),
    });
    const store = makeStore('');
    const resolver = new StripeCustomerResolver(stripe, store);

    const result = await resolver.resolveOrCreate(42, 'learner@example.test');

    expect(result).toBe('cus_new');
    expect(create).toHaveBeenCalled();
  });
});
