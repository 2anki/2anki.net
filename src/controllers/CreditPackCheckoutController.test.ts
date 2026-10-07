import { vi, type Mock } from 'vitest';
import { Response } from 'express';
import CreditPackCheckoutController from './CreditPackCheckoutController';
import { CreateCreditPackCheckoutUseCase } from '../usecases/checkout/CreateCreditPackCheckoutUseCase';

const makeRes = (
  locals: Record<string, unknown> = { owner: 42, email: 'a@b.test' }
) => {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return {
    locals,
    json,
    status,
  } as unknown as Response & { json: Mock; status: Mock };
};

const makeController = (execute: Mock) => {
  const useCase = { execute } as unknown as CreateCreditPackCheckoutUseCase;
  return new CreditPackCheckoutController(useCase);
};

describe('CreditPackCheckoutController', () => {
  it('forwards owner, email, and validated source to the use case', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ url: 'https://stripe/session' });
    const controller = makeController(execute);
    const res = makeRes();
    const req = { body: { source: 'credits_badge' } } as never;

    await controller.createSession(req, res);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        userEmail: 'a@b.test',
        source: 'credits_badge',
      })
    );
    expect(res.json).toHaveBeenCalledWith({ url: 'https://stripe/session' });
  });

  it('drops an unknown source rather than trusting it as a redirect key', async () => {
    const execute = vi.fn().mockResolvedValue({ url: 'https://s' });
    const controller = makeController(execute);
    const req = { body: { source: 'https://evil.example.com' } } as never;

    await controller.createSession(req, makeRes());

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ source: undefined })
    );
  });

  it('returns 401 when there is no authenticated owner', async () => {
    const execute = vi.fn();
    const controller = makeController(execute);
    const res = makeRes({ email: 'a@b.test' });

    await controller.createSession({ body: {} } as never, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it('forwards the resolved Stripe customer id from res.locals to the use case', async () => {
    const execute = vi.fn().mockResolvedValue({ url: 'https://s' });
    const controller = makeController(execute);
    const res = makeRes({
      owner: 42,
      email: 'a@b.test',
      stripeCustomerId: 'cus_123',
    });

    await controller.createSession({ body: {} } as never, res);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: 'cus_123' })
    );
  });

  it('forwards an undefined customer id when the middleware resolved none', async () => {
    const execute = vi.fn().mockResolvedValue({ url: 'https://s' });
    const controller = makeController(execute);

    await controller.createSession({ body: {} } as never, makeRes());

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: undefined })
    );
  });
});
