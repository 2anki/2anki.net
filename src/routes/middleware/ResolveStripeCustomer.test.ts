import { vi, type Mock } from 'vitest';
import { Response } from 'express';

import { applyResolvedStripeCustomer } from './ResolveStripeCustomer';

const run = async (locals: Record<string, unknown>, resolveOrCreate: Mock) => {
  const recordFailure = vi.fn();
  const res = { locals } as unknown as Response;
  await applyResolvedStripeCustomer(
    res,
    () => ({ resolveOrCreate }),
    recordFailure
  );
  return { res, recordFailure };
};

describe('applyResolvedStripeCustomer', () => {
  it('resolves and stashes the customer id for an authenticated caller', async () => {
    const resolveOrCreate = vi.fn().mockResolvedValue('cus_resolved');
    const { res } = await run(
      { owner: 42, email: 'learner@example.test' },
      resolveOrCreate
    );

    expect(resolveOrCreate).toHaveBeenCalledWith(42, 'learner@example.test');
    expect(res.locals.stripeCustomerId).toBe('cus_resolved');
  });

  it('passes an anonymous caller through without touching Stripe', async () => {
    const resolveOrCreate = vi.fn();
    const { res, recordFailure } = await run(
      { email: 'someone@example.test' },
      resolveOrCreate
    );

    expect(resolveOrCreate).not.toHaveBeenCalled();
    expect(res.locals.stripeCustomerId).toBeUndefined();
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it('passes through when the account has no email to resolve against', async () => {
    const resolveOrCreate = vi.fn();
    await run({ owner: 42, email: '' }, resolveOrCreate);

    expect(resolveOrCreate).not.toHaveBeenCalled();
  });

  it('records the failure and leaks no customer id when resolution fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const resolveOrCreate = vi
      .fn()
      .mockRejectedValue(new Error("No such customer: 'cus_leak123'"));

    const { res, recordFailure } = await run(
      { owner: 42, email: 'learner@example.test' },
      resolveOrCreate
    );

    expect(res.locals.stripeCustomerId).toBeUndefined();
    expect(recordFailure).toHaveBeenCalledWith(42);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('cus_');
    errorSpy.mockRestore();
  });

  it('falls back when building the resolver throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const recordFailure = vi.fn();
    const res = {
      locals: { owner: 42, email: 'learner@example.test' },
    } as unknown as Response;

    await applyResolvedStripeCustomer(
      res,
      () => {
        throw new Error('getDatabase failed');
      },
      recordFailure
    );

    expect(res.locals.stripeCustomerId).toBeUndefined();
    expect(recordFailure).toHaveBeenCalledWith(42);
    errorSpy.mockRestore();
  });
});
