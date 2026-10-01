import { Response } from 'express';

import { applyResolvedStripeCustomer } from './ResolveStripeCustomer';

const run = async (
  locals: Record<string, unknown>,
  resolveOrCreate: jest.Mock
) => {
  const record = jest.fn();
  const res = { locals } as unknown as Response;
  await applyResolvedStripeCustomer(res, { resolveOrCreate }, { record });
  return { res, record };
};

describe('applyResolvedStripeCustomer', () => {
  it('resolves and stashes the customer id for an authenticated caller', async () => {
    const resolveOrCreate = jest.fn().mockResolvedValue('cus_resolved');
    const { res } = await run(
      { owner: 42, email: 'learner@example.test' },
      resolveOrCreate
    );

    expect(resolveOrCreate).toHaveBeenCalledWith(42, 'learner@example.test');
    expect(res.locals.stripeCustomerId).toBe('cus_resolved');
  });

  it('passes an anonymous caller through without touching Stripe', async () => {
    const resolveOrCreate = jest.fn();
    const { res, record } = await run(
      { email: 'someone@example.test' },
      resolveOrCreate
    );

    expect(resolveOrCreate).not.toHaveBeenCalled();
    expect(res.locals.stripeCustomerId).toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });

  it('passes through when the account has no email to resolve against', async () => {
    const resolveOrCreate = jest.fn();
    await run({ owner: 42, email: '' }, resolveOrCreate);

    expect(resolveOrCreate).not.toHaveBeenCalled();
  });

  it('records resolve_failed and leaks no customer id in logs when resolution fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const resolveOrCreate = jest
      .fn()
      .mockRejectedValue(new Error("No such customer: 'cus_leak123'"));

    const { res, record } = await run(
      { owner: 42, email: 'learner@example.test' },
      resolveOrCreate
    );

    expect(res.locals.stripeCustomerId).toBeUndefined();
    expect(record).toHaveBeenCalledWith({
      name: 'checkout_customer_resolve',
      user_id: 42,
      props: { outcome: 'resolve_failed' },
    });
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('cus_');
    errorSpy.mockRestore();
  });
});
