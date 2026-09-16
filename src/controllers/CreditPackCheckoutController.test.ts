import { Response } from 'express';
import CreditPackCheckoutController from './CreditPackCheckoutController';
import { CreateCreditPackCheckoutUseCase } from '../usecases/checkout/CreateCreditPackCheckoutUseCase';

const makeRes = (
  locals: Record<string, unknown> = { owner: 42, email: 'a@b.test' }
) => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return {
    locals,
    json,
    status,
  } as unknown as Response & { json: jest.Mock; status: jest.Mock };
};

describe('CreditPackCheckoutController', () => {
  it('forwards owner, email, and validated source to the use case', async () => {
    const execute = jest
      .fn()
      .mockResolvedValue({ url: 'https://stripe/session' });
    const useCase = { execute } as unknown as CreateCreditPackCheckoutUseCase;
    const controller = new CreditPackCheckoutController(useCase);
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
    const execute = jest.fn().mockResolvedValue({ url: 'https://s' });
    const useCase = { execute } as unknown as CreateCreditPackCheckoutUseCase;
    const controller = new CreditPackCheckoutController(useCase);
    const req = { body: { source: 'https://evil.example.com' } } as never;

    await controller.createSession(req, makeRes());

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ source: undefined })
    );
  });

  it('returns 401 when there is no authenticated owner', async () => {
    const execute = jest.fn();
    const useCase = { execute } as unknown as CreateCreditPackCheckoutUseCase;
    const controller = new CreditPackCheckoutController(useCase);
    const res = makeRes({ email: 'a@b.test' });

    await controller.createSession({ body: {} } as never, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(execute).not.toHaveBeenCalled();
  });
});
