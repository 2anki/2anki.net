import { vi, type Mock } from 'vitest';
import { Request, Response } from 'express';
import UnlimitedCheckoutController, {
  UnlimitedCheckoutContext,
} from './UnlimitedCheckoutController';
import { UnlimitedCheckoutUseCase } from '../usecases/checkout/UnlimitedCheckoutUseCase';
import { PricingResolutionError } from '../usecases/checkout/PricingResolutionError';

const makeResponse = (locals: Record<string, unknown> = {}) => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    locals: { owner: 42, email: 'user@example.com', ...locals },
    status: vi.fn(),
    json: vi.fn(),
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

const makeUseCase = (cohort: 'legacy' | 'v2' = 'legacy') =>
  ({
    execute: vi
      .fn()
      .mockResolvedValue({ url: 'https://checkout.stripe.com/test', cohort }),
  }) as unknown as UnlimitedCheckoutUseCase;

const makeContext = (
  overrides: Partial<UnlimitedCheckoutContext> = {}
): UnlimitedCheckoutContext => ({
  pricingV2On: false,
  getUserCreatedAt: vi.fn().mockResolvedValue(null),
  ...overrides,
});

const makeSink = () => ({ record: vi.fn() });

describe('UnlimitedCheckoutController', () => {
  it('returns 400 when interval is missing', async () => {
    const req = { body: {} } as Request;
    const res = makeResponse();
    const controller = new UnlimitedCheckoutController(
      makeUseCase(),
      makeContext(),
      makeSink()
    );

    await controller.createSession(req, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });

  it('returns 400 when interval is invalid', async () => {
    const req = { body: { interval: 'weekly' } } as Request;
    const res = makeResponse();
    const controller = new UnlimitedCheckoutController(
      makeUseCase(),
      makeContext(),
      makeSink()
    );

    await controller.createSession(req, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });

  it('returns 200 with url and passes the flag and createdAt to the use case', async () => {
    const req = { body: { interval: 'month' } } as Request;
    const res = makeResponse();
    const uc = makeUseCase();
    const createdAt = new Date('2026-06-10T00:00:00Z');
    const context = makeContext({
      pricingV2On: true,
      getUserCreatedAt: vi.fn().mockResolvedValue(createdAt),
    });
    const controller = new UnlimitedCheckoutController(uc, context, makeSink());

    await controller.createSession(req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/test' });
    expect(uc.execute as Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        interval: 'month',
        userId: 42,
        userEmail: 'user@example.com',
        pricingV2On: true,
        createdAt,
      })
    );
  });

  it('records a checkout_started event with the resolved cohort', async () => {
    const req = { body: { interval: 'year' } } as Request;
    const res = makeResponse();
    const sink = makeSink();
    const controller = new UnlimitedCheckoutController(
      makeUseCase('v2'),
      makeContext({ pricingV2On: true }),
      sink
    );

    await controller.createSession(req, res as unknown as Response);

    expect(sink.record).toHaveBeenCalledWith({
      name: 'checkout_started',
      user_id: 42,
      props: { plan: 'subscription', interval: 'year', cohort: 'v2' },
    });
  });

  it('records the surface on checkout_started so the interval is attributable', async () => {
    const req = {
      body: { interval: 'year', surface: 'limit-wall' },
    } as Request;
    const res = makeResponse();
    const sink = makeSink();
    const controller = new UnlimitedCheckoutController(
      makeUseCase('v2'),
      makeContext({ pricingV2On: true }),
      sink
    );

    await controller.createSession(req, res as unknown as Response);

    expect(sink.record).toHaveBeenCalledWith({
      name: 'checkout_started',
      user_id: 42,
      props: {
        plan: 'subscription',
        interval: 'year',
        cohort: 'v2',
        surface: 'limit-wall',
      },
    });
  });

  it('omits surface from checkout_started when the caller sent none', async () => {
    const req = { body: { interval: 'month' } } as Request;
    const res = makeResponse();
    const sink = makeSink();
    const controller = new UnlimitedCheckoutController(
      makeUseCase('v2'),
      makeContext({ pricingV2On: true }),
      sink
    );

    await controller.createSession(req, res as unknown as Response);

    const recorded = sink.record.mock.calls[0][0];
    expect(recorded.props).not.toHaveProperty('surface');
  });

  it('forwards the anon_id cookie to the use case when present', async () => {
    const req = {
      body: { interval: 'month' },
      cookies: { anon_id: 'anon-uuid-123' },
    } as unknown as Request;
    const res = makeResponse();
    const uc = makeUseCase();
    const controller = new UnlimitedCheckoutController(
      uc,
      makeContext(),
      makeSink()
    );

    await controller.createSession(req, res as unknown as Response);

    expect(uc.execute as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ anonId: 'anon-uuid-123' })
    );
  });

  it('returns 503 and records no event when pricing resolution fails', async () => {
    const execute = vi
      .fn()
      .mockRejectedValue(new PricingResolutionError('v2_monthly'));
    const uc = { execute } as unknown as UnlimitedCheckoutUseCase;
    const req = { body: { interval: 'month' } } as Request;
    const res = makeResponse();
    const sink = makeSink();
    const controller = new UnlimitedCheckoutController(
      uc,
      makeContext({ pricingV2On: true }),
      sink
    );

    await controller.createSession(req, res as unknown as Response);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ message: expect.any(String) });
    expect(sink.record).not.toHaveBeenCalled();
  });

  it('propagates use case errors', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('stripe down'));
    const uc = { execute } as unknown as UnlimitedCheckoutUseCase;
    const req = { body: { interval: 'month' } } as Request;
    const res = makeResponse();
    const controller = new UnlimitedCheckoutController(
      uc,
      makeContext(),
      makeSink()
    );

    await expect(
      controller.createSession(req, res as unknown as Response)
    ).rejects.toThrow('stripe down');
  });

  it('forwards the resolved Stripe customer id from res.locals', async () => {
    const req = { body: { interval: 'month' } } as Request;
    const res = makeResponse({ stripeCustomerId: 'cus_abc' });
    const uc = makeUseCase();
    const controller = new UnlimitedCheckoutController(
      uc,
      makeContext(),
      makeSink()
    );

    await controller.createSession(req, res as unknown as Response);

    expect(uc.execute as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: 'cus_abc' })
    );
  });
});
