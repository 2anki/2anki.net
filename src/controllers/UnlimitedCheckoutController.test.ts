import { vi, type Mock } from 'vitest';
import { Request, Response } from 'express';
import geoip from 'geoip-lite';
import UnlimitedCheckoutController from './UnlimitedCheckoutController';
import { UnlimitedCheckoutUseCase } from '../usecases/checkout/UnlimitedCheckoutUseCase';
import { PricingResolutionError } from '../usecases/checkout/PricingResolutionError';
import { LapsedSubscriptionError } from '../usecases/checkout/LapsedSubscriptions';

vi.mock('geoip-lite', () => ({ default: { lookup: vi.fn() } }));

beforeEach(() => {
  vi.mocked(geoip.lookup).mockReset();
});

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const CLIENT_IP = '203.0.113.9';

const checkoutRequest = ({
  cookies = {},
  headers = {},
}: {
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
} = {}) =>
  ({
    ip: CLIENT_IP,
    body: { interval: 'month' },
    cookies,
    headers,
  }) as unknown as Request;

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
      props: {
        plan: 'subscription',
        interval: 'year',
        cohort: 'v2',
        country: null,
        device: 'unknown',
      },
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
        country: null,
        device: 'unknown',
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

  it.each([
    ['granted', true],
    ['denied', false],
  ])(
    'tells the use case whether the anon id may be tracked when consent is %s',
    async (consent, expected) => {
      const req = {
        body: { interval: 'month' },
        cookies: { anon_id: 'anon-uuid-123', cookie_consent: consent },
      } as unknown as Request;
      const res = makeResponse();
      const uc = makeUseCase();
      const controller = new UnlimitedCheckoutController(uc, makeSink());

      await controller.createSession(req, res as unknown as Response);

      expect(uc.execute as Mock).toHaveBeenCalledWith(
        expect.objectContaining({
          anonId: 'anon-uuid-123',
          anonIdTrackingAllowed: expected,
        })
      );
    }
  );

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

const startCheckout = async (req: Request) => {
  const sink = makeSink();
  const res = makeResponse();
  const uc = makeUseCase();
  const controller = new UnlimitedCheckoutController(uc, sink);
  await controller.createSession(req, res as unknown as Response);
  return { sink, res, uc };
};

const recordedProps = (sink: ReturnType<typeof makeSink>) =>
  sink.record.mock.calls[0][0].props as Record<string, unknown>;

describe('UnlimitedCheckoutController checkout_started country and device', () => {
  it('records the country for a subscriber outside the EEA', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'US' } as never);

    const { sink } = await startCheckout(checkoutRequest());

    expect(geoip.lookup).toHaveBeenCalledWith(CLIENT_IP);
    expect(recordedProps(sink)).toMatchObject({ country: 'US' });
  });

  it('records no country for an EEA subscriber who has not consented', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'FR' } as never);

    const { sink } = await startCheckout(checkoutRequest());

    expect(recordedProps(sink)).toMatchObject({ country: null });
  });

  it('records the country for an EEA subscriber who granted consent', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'FR' } as never);

    const { sink } = await startCheckout(
      checkoutRequest({ cookies: { cookie_consent: 'granted' } })
    );

    expect(recordedProps(sink)).toMatchObject({ country: 'FR' });
  });

  it('records no country when the subscriber denied consent outside the EEA', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'US' } as never);

    const { sink } = await startCheckout(
      checkoutRequest({ cookies: { cookie_consent: 'denied' } })
    );

    expect(recordedProps(sink)).toMatchObject({ country: null });
  });

  it('records no country when an EEA subscriber denied consent', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'FR' } as never);

    const { sink } = await startCheckout(
      checkoutRequest({ cookies: { cookie_consent: 'denied' } })
    );

    expect(recordedProps(sink)).toMatchObject({ country: null });
  });

  it.each([
    ['an iPhone', IPHONE_UA, 'mobile'],
    ['a Mac', MAC_UA, 'desktop'],
  ])('records the device class for %s', async (_label, ua, device) => {
    const { sink } = await startCheckout(
      checkoutRequest({ headers: { 'user-agent': ua } })
    );

    expect(recordedProps(sink)).toMatchObject({ device });
  });

  it('never puts the client IP in the event', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'US' } as never);

    const { sink } = await startCheckout(
      checkoutRequest({ headers: { 'user-agent': MAC_UA } })
    );

    expect(JSON.stringify(sink.record.mock.calls[0][0])).not.toContain(
      CLIENT_IP
    );
  });

  it('returns the checkout url unchanged', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'US' } as never);

    const { res, uc } = await startCheckout(
      checkoutRequest({ headers: { 'user-agent': IPHONE_UA } })
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ url: 'https://checkout.stripe.com/test' });
    expect((uc.execute as Mock).mock.calls[0][0]).not.toHaveProperty('country');
    expect((uc.execute as Mock).mock.calls[0][0]).not.toHaveProperty('device');
  });
});
