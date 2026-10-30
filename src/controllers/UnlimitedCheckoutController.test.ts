import { vi, type Mock } from 'vitest';
import { Request, Response } from 'express';
import UnlimitedCheckoutController from './UnlimitedCheckoutController';
import { UnlimitedCheckoutUseCase } from '../usecases/checkout/UnlimitedCheckoutUseCase';
import { PricingResolutionError } from '../usecases/checkout/PricingResolutionError';
import { LapsedSubscriptionError } from '../usecases/checkout/LapsedSubscriptions';

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

const makeUseCase = () =>
  ({
    execute: vi.fn().mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
      cohort: 'v2',
    }),
  }) as unknown as UnlimitedCheckoutUseCase;

const makeSink = () => ({ record: vi.fn() });

describe('UnlimitedCheckoutController', () => {
  it('returns 400 when interval is missing', async () => {
    const req = { body: {} } as Request;
    const res = makeResponse();
    const controller = new UnlimitedCheckoutController(
      makeUseCase(),
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
      makeSink()
    );

    await controller.createSession(req, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });

  it('returns 200 with url and passes the caller to the use case', async () => {
    const req = { body: { interval: 'month' } } as Request;
    const res = makeResponse();
    const uc = makeUseCase();
    const controller = new UnlimitedCheckoutController(uc, makeSink());

    await controller.createSession(req, res as unknown as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/test' });
    expect(uc.execute as Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        interval: 'month',
        userId: 42,
        userEmail: 'user@example.com',
      })
    );
  });

  it('records a checkout_started event with the resolved cohort', async () => {
    const req = { body: { interval: 'year' } } as Request;
    const res = makeResponse();
    const sink = makeSink();
    const controller = new UnlimitedCheckoutController(makeUseCase(), sink);

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
    const controller = new UnlimitedCheckoutController(makeUseCase(), sink);

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
    const controller = new UnlimitedCheckoutController(makeUseCase(), sink);

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
    const controller = new UnlimitedCheckoutController(uc, makeSink());

    await controller.createSession(req, res as unknown as Response);

    expect(uc.execute as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ anonId: 'anon-uuid-123' })
    );
  });

  it('forwards the connector pricing variant to the use case', async () => {
    const req = {
      body: { interval: 'month', variant: 'mcp-day-first' },
    } as unknown as Request;
    const uc = makeUseCase();
    const controller = new UnlimitedCheckoutController(uc, makeSink());

    await controller.createSession(req, makeResponse() as unknown as Response);

    expect(uc.execute as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'mcp-day-first' })
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
    const controller = new UnlimitedCheckoutController(uc, sink);

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
    const controller = new UnlimitedCheckoutController(uc, makeSink());

    await expect(
      controller.createSession(req, res as unknown as Response)
    ).rejects.toThrow('stripe down');
  });

  it('forwards the resolved Stripe customer id from res.locals', async () => {
    const req = { body: { interval: 'month' } } as Request;
    const res = makeResponse({ stripeCustomerId: 'cus_abc' });
    const uc = makeUseCase();
    const controller = new UnlimitedCheckoutController(uc, makeSink());

    await controller.createSession(req, res as unknown as Response);

    expect(uc.execute as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: 'cus_abc' })
    );
  });
});

describe('UnlimitedCheckoutController ad-click attribution', () => {
  it('forwards the parsed ad_click cookie to the use case', async () => {
    const req = {
      body: { interval: 'month' },
      cookies: {
        cookie_consent: 'granted',
        ad_click: encodeURIComponent(
          JSON.stringify({ gclid: 'Cj0abc', utm_source: 'google' })
        ),
      },
    } as unknown as Request;
    const res = makeResponse();
    const uc = makeUseCase();
    const controller = new UnlimitedCheckoutController(uc, makeSink());
    await controller.createSession(req, res as unknown as Response);
    expect(uc.execute as Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        adClick: { gclid: 'Cj0abc', utm_source: 'google' },
      })
    );
  });
});

describe('UnlimitedCheckoutController GA measurement', () => {
  it('forwards the GA client id and session id when tracking is allowed', async () => {
    const req = {
      body: { interval: 'month' },
      cookies: {
        cookie_consent: 'granted',
        _ga: 'GA1.1.1234567890.987654321',
        _ga_X6K69TY3EX: 'GS1.1.1744000000.5.1.1744000100.0.0.0',
      },
    } as unknown as Request;
    const res = makeResponse();
    const uc = makeUseCase();
    const controller = new UnlimitedCheckoutController(uc, makeSink());
    await controller.createSession(req, res as unknown as Response);
    expect(uc.execute as Mock).toHaveBeenCalledWith(
      expect.objectContaining({
        gaClientId: '1234567890.987654321',
        gaSessionId: '1744000000',
      })
    );
  });
});

describe('UnlimitedCheckoutController with a lapsed or foreign-currency plan', () => {
  it('returns 409 lapsed_subscription with the old plan and its pay link', async () => {
    const execute = vi.fn().mockRejectedValue(
      new LapsedSubscriptionError({
        subscriptionId: 'sub_old',
        amount: 200,
        currency: 'eur',
        interval: 'month',
        openInvoiceId: 'in_open',
        payUrl: 'https://invoice.stripe.com/i/test',
      })
    );
    const uc = { execute } as unknown as UnlimitedCheckoutUseCase;
    const req = { body: { interval: 'year' } } as Request;
    const res = makeResponse();
    const sink = makeSink();
    const controller = new UnlimitedCheckoutController(uc, sink);

    await controller.createSession(req, res as unknown as Response);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      code: 'lapsed_subscription',
      message: expect.any(String),
      expiresAt: null,
      lapsedPlan: {
        amount: 200,
        currency: 'eur',
        interval: 'month',
        payUrl: 'https://invoice.stripe.com/i/test',
      },
    });
    expect(sink.record).not.toHaveBeenCalled();
  });

  it('forwards replaceLapsed only when the body sets it to true', async () => {
    const uc = makeUseCase();
    const controller = new UnlimitedCheckoutController(uc, makeSink());

    await controller.createSession(
      { body: { interval: 'year', replaceLapsed: true } } as Request,
      makeResponse() as unknown as Response
    );
    await controller.createSession(
      { body: { interval: 'year', replaceLapsed: 'yes' } } as Request,
      makeResponse() as unknown as Response
    );

    const calls = (uc.execute as Mock).mock.calls;
    expect(calls[0][0]).toMatchObject({ replaceLapsed: true });
    expect(calls[1][0]).toMatchObject({ replaceLapsed: false });
  });

  it('returns 409 currency_conflict when Stripe refuses to mix currencies', async () => {
    const execute = vi.fn().mockRejectedValue({
      type: 'StripeInvalidRequestError',
      message:
        'You cannot combine currencies on a single customer. This customer has an active subscription with currency eur.',
    });
    const uc = { execute } as unknown as UnlimitedCheckoutUseCase;
    const res = makeResponse();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const controller = new UnlimitedCheckoutController(uc, makeSink());

    await controller.createSession(
      { body: { interval: 'year' } } as Request,
      res as unknown as Response
    );

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      code: 'currency_conflict',
      expiresAt: null,
    });
  });
});
