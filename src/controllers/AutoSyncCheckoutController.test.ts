import { Request, Response } from 'express';
import AutoSyncCheckoutController from './AutoSyncCheckoutController';
import { AutoSyncCheckoutUseCase } from '../usecases/checkout/AutoSyncCheckoutUseCase';

const makeRequest = (locals: Record<string, unknown> = {}): Request =>
  ({ locals }) as unknown as Request;

const makeResponse = () => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    locals: {} as Record<string, unknown>,
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
};

const makeUseCase = (
  result: Awaited<ReturnType<AutoSyncCheckoutUseCase['execute']>>
) =>
  ({
    execute: jest.fn().mockResolvedValue(result),
  }) as unknown as AutoSyncCheckoutUseCase;

describe('AutoSyncCheckoutController', () => {
  test('returns 200 with url on successful session creation', async () => {
    const uc = makeUseCase({ url: 'https://checkout.stripe.com/test' });
    const controller = new AutoSyncCheckoutController(uc);
    const req = makeRequest({ owner: 42, email: 'user@example.com' });
    const res = makeResponse();

    await controller.createSession(req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/test' });
  });

  test('returns 200 with status cap_reached', async () => {
    const uc = makeUseCase({ status: 'cap_reached' });
    const controller = new AutoSyncCheckoutController(uc);
    const req = makeRequest({ owner: 42, email: 'user@example.com' });
    const res = makeResponse();

    await controller.createSession(req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'cap_reached' });
  });

  test('returns 200 with status already_subscribed', async () => {
    const uc = makeUseCase({ status: 'already_subscribed' });
    const controller = new AutoSyncCheckoutController(uc);
    const req = makeRequest({ owner: 42, email: 'user@example.com' });
    const res = makeResponse();

    await controller.createSession(req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'already_subscribed' });
  });

  test('forwards the anon_id cookie to the use case when present', async () => {
    const uc = makeUseCase({ url: 'https://checkout.stripe.com/test' });
    const controller = new AutoSyncCheckoutController(uc);
    const req = { cookies: { anon_id: 'anon-uuid-123' } } as unknown as Request;
    const res = makeResponse();
    res.locals = { owner: 99, email: 'alice@example.com' };

    await controller.createSession(req, res as unknown as Response);

    expect(uc.execute as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ anonId: 'anon-uuid-123' })
    );
  });

  test('passes owner and email from res.locals to the use case', async () => {
    const uc = makeUseCase({ url: 'https://checkout.stripe.com/test' });
    const controller = new AutoSyncCheckoutController(uc);
    const req = makeRequest();
    const res = makeResponse();
    res.locals = { owner: 99, email: 'alice@example.com' };

    await controller.createSession(req, res as unknown as Response);

    expect(uc.execute as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 99, userEmail: 'alice@example.com' })
    );
  });

  test('forwards the resolved Stripe customer id from res.locals', async () => {
    const uc = makeUseCase({ url: 'https://checkout.stripe.com/test' });
    const controller = new AutoSyncCheckoutController(uc);
    const req = makeRequest();
    const res = makeResponse();
    res.locals = {
      owner: 99,
      email: 'alice@example.com',
      stripeCustomerId: 'cus_abc',
    };

    await controller.createSession(req, res as unknown as Response);

    expect(uc.execute as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: 'cus_abc' })
    );
  });
});
