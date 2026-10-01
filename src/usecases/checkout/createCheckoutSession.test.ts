import {
  createCheckoutSession,
  isStaleCustomerError,
} from './createCheckoutSession';

const staleError = () =>
  Object.assign(new Error("No such customer: 'cus_stale999'"), {
    code: 'resource_missing',
    param: 'customer',
  });

const makeStripe = (create: jest.Mock) =>
  ({ checkout: { sessions: { create } } }) as never;

const params = {
  mode: 'payment',
  customer: 'cus_stale999',
} as never;

describe('isStaleCustomerError', () => {
  it('is true only for a missing customer parameter', () => {
    expect(isStaleCustomerError(staleError())).toBe(true);
    expect(
      isStaleCustomerError(
        Object.assign(new Error('x'), {
          code: 'resource_missing',
          param: 'price',
        })
      )
    ).toBe(false);
    expect(isStaleCustomerError(new Error('plain'))).toBe(false);
  });
});

describe('createCheckoutSession', () => {
  it('creates the session without recovery when it succeeds', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'cs_1' });
    const recover = jest.fn();

    const session = await createCheckoutSession(
      makeStripe(create),
      params,
      recover
    );

    expect(session).toEqual({ id: 'cs_1' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(recover).not.toHaveBeenCalled();
  });

  it('replaces a stale customer and retries once with the fresh id', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(staleError())
      .mockResolvedValueOnce({ id: 'cs_retry' });
    const recover = jest.fn().mockResolvedValue('cus_fresh');

    const session = await createCheckoutSession(
      makeStripe(create),
      params,
      recover
    );

    expect(session).toEqual({ id: 'cs_retry' });
    expect(recover).toHaveBeenCalledWith('cus_stale999');
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ customer: 'cus_fresh' })
    );
  });

  it('logs no customer id while recovering from a stale customer', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const create = jest
      .fn()
      .mockRejectedValueOnce(staleError())
      .mockResolvedValueOnce({ id: 'cs_retry' });
    const recover = jest.fn().mockResolvedValue('cus_fresh');

    await createCheckoutSession(makeStripe(create), params, recover);

    const logged = JSON.stringify(warnSpy.mock.calls);
    expect(logged).not.toContain('cus_');
    warnSpy.mockRestore();
  });

  it('propagates a non-stale error without recovering', async () => {
    const other = Object.assign(new Error('rate limited'), {
      code: 'rate_limit',
    });
    const create = jest.fn().mockRejectedValue(other);
    const recover = jest.fn();

    await expect(
      createCheckoutSession(makeStripe(create), params, recover)
    ).rejects.toBe(other);
    expect(recover).not.toHaveBeenCalled();
  });

  it('propagates when there is no recovery to run', async () => {
    const create = jest.fn().mockRejectedValue(staleError());

    await expect(
      createCheckoutSession(makeStripe(create), params)
    ).rejects.toMatchObject({ code: 'resource_missing' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not retry when recovery returns the same stale id', async () => {
    const create = jest.fn().mockRejectedValue(staleError());
    const recover = jest.fn().mockResolvedValue('cus_stale999');

    await expect(
      createCheckoutSession(makeStripe(create), params, recover)
    ).rejects.toMatchObject({ code: 'resource_missing' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
