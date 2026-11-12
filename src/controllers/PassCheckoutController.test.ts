import { vi, type Mock } from 'vitest';
import { Response } from 'express';
import geoip from 'geoip-lite';
import PassCheckoutController from './PassCheckoutController';
import { CreatePassCheckoutUseCase } from '../usecases/checkout/CreatePassCheckoutUseCase';
import type { PassKind } from '../data_layer/UserPassRepository';

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
} = {}) => ({ ip: CLIENT_IP, cookies, headers }) as never;

const recordedProps = (record: Mock) =>
  record.mock.calls[0][0].props as Record<string, unknown>;

const makeRes = (
  locals: Record<string, unknown> = { owner: 42, email: 'a@b.test' }
) => {
  const json = vi.fn();
  return {
    locals,
    json,
  } as unknown as Response & {
    json: Mock;
  };
};

const makeController = (
  execute: Mock,
  passKind: PassKind = '24h'
): { controller: PassCheckoutController; record: Mock } => {
  const record = vi.fn();
  const useCase = { execute } as unknown as CreatePassCheckoutUseCase;
  return {
    controller: new PassCheckoutController(useCase, passKind, { record }),
    record,
  };
};

const resolving = () =>
  vi.fn().mockResolvedValue({ url: 'https://stripe/session' });

describe('PassCheckoutController', () => {
  it('forwards owner and email to the use case and serializes the result', async () => {
    const execute = resolving();
    const { controller } = makeController(execute);
    const res = makeRes();

    await controller.createSession({} as never, res);

    expect(execute).toHaveBeenCalledWith({
      userId: 42,
      userEmail: 'a@b.test',
      anonIdTrackingAllowed: false,
    });
    expect(res.json).toHaveBeenCalledWith({ url: 'https://stripe/session' });
  });

  it('forwards the anon_id cookie to the use case when present', async () => {
    const execute = resolving();
    const { controller } = makeController(execute);
    const req = { cookies: { anon_id: 'anon-uuid-123' } } as never;

    await controller.createSession(req, makeRes());

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ anonId: 'anon-uuid-123' })
    );
  });

  it('forwards the resolved Stripe customer id from res.locals', async () => {
    const execute = resolving();
    const { controller } = makeController(execute);
    const res = makeRes({
      owner: 42,
      email: 'a@b.test',
      stripeCustomerId: 'cus_abc',
    });

    await controller.createSession({} as never, res);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: 'cus_abc' })
    );
  });

  it('propagates use case errors', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('stripe down'));
    const { controller } = makeController(execute);

    await expect(
      controller.createSession({} as never, makeRes())
    ).rejects.toThrow('stripe down');
  });

  it.each<PassKind>(['24h', '7d', '120d'])(
    'records checkout_started carrying %s as the plan',
    async (passKind) => {
      vi.mocked(geoip.lookup).mockReturnValue({ country: 'US' } as never);
      const { controller, record } = makeController(resolving(), passKind);

      await controller.createSession(
        checkoutRequest({ headers: { 'user-agent': IPHONE_UA } }),
        makeRes()
      );

      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'checkout_started',
          props: expect.objectContaining({
            plan: passKind,
            country: 'US',
            device: 'mobile',
          }),
        })
      );
    }
  );

  it('attributes the start to the signed-in user, not to an anonymous id', async () => {
    const { controller, record } = makeController(resolving());
    const req = { cookies: { anon_id: 'anon-uuid-123' } } as never;

    await controller.createSession(req, makeRes());

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 42, anonymous_id: null })
    );
  });

  it.each([
    ['granted consent', 'granted', 'anon-uuid-123', true],
    ['declined', 'denied', null, false],
  ])(
    'binds an anonymous pass to the anon id whether or not the visitor %s, recording the start under it only with consent',
    async (_label, consent, expectedAnonymousId, expectedTrackingAllowed) => {
      const execute = resolving();
      const { controller, record } = makeController(execute);
      const req = {
        cookies: { anon_id: 'anon-uuid-123', cookie_consent: consent },
      } as never;

      await controller.createSession(req, makeRes({}));

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          anonId: 'anon-uuid-123',
          anonIdTrackingAllowed: expectedTrackingAllowed,
        })
      );
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: null,
          anonymous_id: expectedAnonymousId,
        })
      );
    }
  );

  it.each([
    ['granted consent', 'granted', true],
    ['declined', 'denied', false],
  ])(
    'tells the use case whether a signed-in pass buyer who %s may have the anon id tracked, starting under the user only',
    async (_label, consent, expectedTrackingAllowed) => {
      const execute = resolving();
      const { controller, record } = makeController(execute);
      const req = {
        cookies: { anon_id: 'anon-uuid-123', cookie_consent: consent },
      } as never;

      await controller.createSession(req, makeRes());

      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 42,
          anonId: 'anon-uuid-123',
          anonIdTrackingAllowed: expectedTrackingAllowed,
        })
      );
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 42, anonymous_id: null })
      );
    }
  );

  it('carries the surface and pricing variant so starts join to completions', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'US' } as never);
    const { controller, record } = makeController(resolving());
    const req = {
      ip: CLIENT_IP,
      headers: { 'user-agent': MAC_UA },
      body: { surface: 'limit-wall', variant: 'semester-first' },
    } as never;

    await controller.createSession(req, makeRes());

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          surface: 'limit-wall',
          variant: 'semester-first',
          country: 'US',
          device: 'desktop',
        }),
      })
    );
  });

  it('records the connector pricing variant on checkout_started', async () => {
    const { controller, record } = makeController(resolving());
    const req = {
      body: { surface: 'pricing_page', variant: 'mcp-day-first' },
    } as never;

    await controller.createSession(req, makeRes());

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'checkout_started',
        props: expect.objectContaining({
          surface: 'pricing_page',
          variant: 'mcp-day-first',
        }),
      })
    );
  });

  it('records nothing when checkout could not be created', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('stripe down'));
    const { controller, record } = makeController(execute);

    await expect(
      controller.createSession({} as never, makeRes())
    ).rejects.toThrow('stripe down');

    expect(record).not.toHaveBeenCalled();
  });
});

describe('PassCheckoutController ad-click attribution', () => {
  it('forwards the parsed ad_click cookie to the use case', async () => {
    const execute = vi.fn().mockResolvedValue({ url: 'https://s' });
    const { controller } = makeController(execute);
    const req = {
      cookies: {
        cookie_consent: 'granted',
        ad_click: encodeURIComponent(
          JSON.stringify({ gclid: 'Cj0abc', utm_source: 'google' })
        ),
      },
    } as never;
    await controller.createSession(req, makeRes());
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        adClick: { gclid: 'Cj0abc', utm_source: 'google' },
      })
    );
  });

  it('forwards the campaign tags from the body when there is no ad_click cookie', async () => {
    const execute = vi.fn().mockResolvedValue({ url: 'https://s' });
    const { controller } = makeController(execute);
    const req = {
      cookies: { anon_id: 'anon-1' },
      body: { campaign: { utm_source: 'google', utm_campaign: 'ai-search' } },
    } as never;
    await controller.createSession(req, makeRes({}));
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        anonId: 'anon-1',
        adClick: { utm_source: 'google', utm_campaign: 'ai-search' },
      })
    );
  });
});

describe('PassCheckoutController GA measurement', () => {
  it('forwards the GA client id and session id when tracking is allowed', async () => {
    const execute = vi.fn().mockResolvedValue({ url: 'https://s' });
    const { controller } = makeController(execute);
    const req = {
      cookies: {
        cookie_consent: 'granted',
        _ga: 'GA1.1.1234567890.987654321',
        _ga_X6K69TY3EX: 'GS1.1.1744000000.5.1.1744000100.0.0.0',
      },
    } as never;
    await controller.createSession(req, makeRes());
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        gaClientId: '1234567890.987654321',
        gaSessionId: '1744000000',
      })
    );
  });
});

describe('PassCheckoutController checkout_started country and device', () => {
  it('records the country for a visitor outside the EEA', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'US' } as never);
    const { controller, record } = makeController(resolving());

    await controller.createSession(checkoutRequest(), makeRes({}));

    expect(geoip.lookup).toHaveBeenCalledWith(CLIENT_IP);
    expect(recordedProps(record)).toMatchObject({ country: 'US' });
  });

  it('records no country for an EEA visitor who has not consented', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'DE' } as never);
    const { controller, record } = makeController(resolving());

    await controller.createSession(checkoutRequest(), makeRes({}));

    expect(recordedProps(record)).toMatchObject({ country: null });
  });

  it('records the country for an EEA visitor who granted consent', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'DE' } as never);
    const { controller, record } = makeController(resolving());

    await controller.createSession(
      checkoutRequest({ cookies: { cookie_consent: 'granted' } }),
      makeRes()
    );

    expect(recordedProps(record)).toMatchObject({ country: 'DE' });
  });

  it('records no country when the visitor denied consent outside the EEA', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'US' } as never);
    const { controller, record } = makeController(resolving());

    await controller.createSession(
      checkoutRequest({ cookies: { cookie_consent: 'denied' } }),
      makeRes()
    );

    expect(recordedProps(record)).toMatchObject({ country: null });
  });

  it('records no country when an EEA visitor denied consent', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'DE' } as never);
    const { controller, record } = makeController(resolving());

    await controller.createSession(
      checkoutRequest({ cookies: { cookie_consent: 'denied' } }),
      makeRes()
    );

    expect(recordedProps(record)).toMatchObject({ country: null });
  });

  it('ignores a spoofed CDN country header', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'DE' } as never);
    const { controller, record } = makeController(resolving());

    await controller.createSession(
      checkoutRequest({ headers: { 'cf-ipcountry': 'US' } }),
      makeRes({})
    );

    expect(recordedProps(record)).toMatchObject({ country: null });
  });

  it.each([
    ['an iPhone', IPHONE_UA, 'mobile'],
    ['a Mac', MAC_UA, 'desktop'],
  ])('records the device class for %s', async (_label, ua, device) => {
    const { controller, record } = makeController(resolving());

    await controller.createSession(
      checkoutRequest({ headers: { 'user-agent': ua } }),
      makeRes({})
    );

    expect(recordedProps(record)).toMatchObject({ device });
  });

  it('records the device even when the visitor denied consent', async () => {
    const { controller, record } = makeController(resolving());

    await controller.createSession(
      checkoutRequest({
        cookies: { cookie_consent: 'denied' },
        headers: { 'user-agent': IPHONE_UA },
      }),
      makeRes()
    );

    expect(recordedProps(record)).toMatchObject({ device: 'mobile' });
  });

  it('never puts the client IP in the event', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'US' } as never);
    const { controller, record } = makeController(resolving());

    await controller.createSession(
      checkoutRequest({ headers: { 'user-agent': MAC_UA } }),
      makeRes({})
    );

    expect(JSON.stringify(record.mock.calls[0][0])).not.toContain(CLIENT_IP);
  });

  it('returns the checkout session unchanged', async () => {
    vi.mocked(geoip.lookup).mockReturnValue({ country: 'US' } as never);
    const execute = resolving();
    const { controller } = makeController(execute);
    const res = makeRes();

    await controller.createSession(
      checkoutRequest({ headers: { 'user-agent': IPHONE_UA } }),
      res
    );

    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ url: 'https://stripe/session' });
    expect(execute.mock.calls[0][0]).not.toHaveProperty('country');
    expect(execute.mock.calls[0][0]).not.toHaveProperty('device');
  });
});
