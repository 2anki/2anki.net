import { NextFunction, Request, Response } from 'express';

import { makeResolveStripeCustomer } from './ResolveStripeCustomer';

const run = async (
  locals: Record<string, unknown>,
  resolveOrCreate: jest.Mock
) => {
  const next = jest.fn() as NextFunction;
  const res = { locals } as unknown as Response;
  await makeResolveStripeCustomer({ resolver: { resolveOrCreate } })(
    {} as Request,
    res,
    next
  );
  return { next, res };
};

describe('ResolveStripeCustomer', () => {
  it('resolves and stashes the customer id for an authenticated caller', async () => {
    const resolveOrCreate = jest.fn().mockResolvedValue('cus_resolved');
    const { next, res } = await run(
      { owner: 42, email: 'learner@example.test' },
      resolveOrCreate
    );

    expect(resolveOrCreate).toHaveBeenCalledWith(42, 'learner@example.test');
    expect(res.locals.stripeCustomerId).toBe('cus_resolved');
    expect(next).toHaveBeenCalled();
  });

  it('passes an anonymous caller through without touching Stripe', async () => {
    const resolveOrCreate = jest.fn();
    const { next, res } = await run(
      { email: 'someone@example.test' },
      resolveOrCreate
    );

    expect(resolveOrCreate).not.toHaveBeenCalled();
    expect(res.locals.stripeCustomerId).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it('passes through when the account has no email to resolve against', async () => {
    const resolveOrCreate = jest.fn();
    const { next } = await run({ owner: 42, email: '' }, resolveOrCreate);

    expect(resolveOrCreate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('degrades to the no-customer fallback when resolution fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const resolveOrCreate = jest
      .fn()
      .mockRejectedValue(new Error('stripe down'));
    const { next, res } = await run(
      { owner: 42, email: 'learner@example.test' },
      resolveOrCreate
    );

    expect(res.locals.stripeCustomerId).toBeUndefined();
    expect(next).toHaveBeenCalled();
    (console.error as jest.Mock).mockRestore();
  });
});
