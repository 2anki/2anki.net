import {
  StaleCheckoutCustomerRefresher,
  recoverWith,
} from './StaleCheckoutCustomerRefresher';

describe('StaleCheckoutCustomerRefresher', () => {
  it('clears the stale id then resolves a fresh customer', async () => {
    const clearStripeCustomerIdIf = jest.fn().mockResolvedValue(undefined);
    const resolveOrCreate = jest.fn().mockResolvedValue('cus_fresh');
    const refresher = new StaleCheckoutCustomerRefresher(
      { clearStripeCustomerIdIf },
      { resolveOrCreate }
    );

    const result = await refresher.refresh(
      42,
      'learner@example.test',
      'cus_stale'
    );

    expect(clearStripeCustomerIdIf).toHaveBeenCalledWith(42, 'cus_stale');
    expect(resolveOrCreate).toHaveBeenCalledWith(42, 'learner@example.test');
    expect(result).toBe('cus_fresh');
  });

  it('clears before it resolves so the resolve sees a cleared row', async () => {
    const order: string[] = [];
    const clearStripeCustomerIdIf = jest.fn().mockImplementation(async () => {
      order.push('clear');
    });
    const resolveOrCreate = jest.fn().mockImplementation(async () => {
      order.push('resolve');
      return 'cus_fresh';
    });
    const refresher = new StaleCheckoutCustomerRefresher(
      { clearStripeCustomerIdIf },
      { resolveOrCreate }
    );

    await refresher.refresh(42, 'learner@example.test', 'cus_stale');

    expect(order).toEqual(['clear', 'resolve']);
  });
});

describe('recoverWith', () => {
  it('binds the refresher to the caller for a signed-in account', async () => {
    const refresh = jest.fn().mockResolvedValue('cus_fresh');
    const recover = recoverWith({ refresh }, 42, 'learner@example.test');

    expect(recover).toBeDefined();
    await recover!('cus_stale');
    expect(refresh).toHaveBeenCalledWith(
      42,
      'learner@example.test',
      'cus_stale'
    );
  });

  it('returns undefined when there is no account to refresh for', () => {
    const refresh = jest.fn();
    expect(recoverWith({ refresh }, undefined, 'a@b.test')).toBeUndefined();
    expect(recoverWith({ refresh }, 42, undefined)).toBeUndefined();
    expect(recoverWith({ refresh }, 42, '')).toBeUndefined();
    expect(recoverWith(undefined, 42, 'a@b.test')).toBeUndefined();
  });
});
