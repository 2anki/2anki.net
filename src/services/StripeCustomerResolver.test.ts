process.env.THE_HASHING_SECRET = 'test-hashing-secret';

import { StripeCustomerResolver } from './StripeCustomerResolver';

const makeStripe = (overrides: Record<string, jest.Mock> = {}) => {
  const list = overrides.list ?? jest.fn().mockResolvedValue({ data: [] });
  const search = overrides.search ?? jest.fn().mockResolvedValue({ data: [] });
  const create =
    overrides.create ?? jest.fn().mockResolvedValue({ id: 'cus_created' });
  const del = overrides.del ?? jest.fn().mockResolvedValue({ deleted: true });
  return {
    stripe: { customers: { list, search, create, del } } as never,
    list,
    search,
    create,
    del,
  };
};

const makeStore = (stored: string | null, claimReturns?: string) => {
  const getStripeCustomerId = jest.fn().mockResolvedValue(stored);
  const claimStripeCustomerId = jest
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

  it('adopts the existing customer found by email list and stores it', async () => {
    const { stripe, create, search } = makeStripe({
      list: jest.fn().mockResolvedValue({ data: [{ id: 'cus_existing' }] }),
    });
    const store = makeStore(null);
    const resolver = new StripeCustomerResolver(stripe, store);

    const result = await resolver.resolveOrCreate(42, 'learner@example.test');

    expect(result).toBe('cus_existing');
    expect(store.claimStripeCustomerId).toHaveBeenCalledWith(
      42,
      'cus_existing'
    );
    expect(search).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('falls back to search when list returns nothing and adopts the hit', async () => {
    const { stripe, create } = makeStripe({
      list: jest.fn().mockResolvedValue({ data: [] }),
      search: jest.fn().mockResolvedValue({ data: [{ id: 'cus_searched' }] }),
    });
    const store = makeStore(null);
    const resolver = new StripeCustomerResolver(stripe, store);

    const result = await resolver.resolveOrCreate(42, 'learner@example.test');

    expect(result).toBe('cus_searched');
    expect(store.claimStripeCustomerId).toHaveBeenCalledWith(
      42,
      'cus_searched'
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a new customer carrying the user id when none exists', async () => {
    const { stripe, create } = makeStripe({
      create: jest.fn().mockResolvedValue({ id: 'cus_new' }),
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

  it('deletes the customer it just created when it loses the claim race', async () => {
    const { stripe, del } = makeStripe({
      create: jest.fn().mockResolvedValue({ id: 'cus_mine' }),
    });
    const store = makeStore(null, 'cus_rival');
    const resolver = new StripeCustomerResolver(stripe, store);

    const result = await resolver.resolveOrCreate(42, 'learner@example.test');

    expect(result).toBe('cus_rival');
    expect(del).toHaveBeenCalledWith('cus_mine');
  });

  it('treats an empty stored id as a miss and resolves afresh', async () => {
    const { stripe, list } = makeStripe({
      list: jest.fn().mockResolvedValue({ data: [{ id: 'cus_existing' }] }),
    });
    const store = makeStore('');
    const resolver = new StripeCustomerResolver(stripe, store);

    const result = await resolver.resolveOrCreate(42, 'learner@example.test');

    expect(result).toBe('cus_existing');
    expect(list).toHaveBeenCalled();
  });
});
