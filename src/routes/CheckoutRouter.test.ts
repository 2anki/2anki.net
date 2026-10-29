import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { clearResolvedPriceIdCache } from '../services/StripePriceResolver';

const mockStripeCreate = vi.fn();
const mockStripeRetrieve = vi.fn();
const mockPriceRetrieve = vi.fn();
const mockPriceList = vi.fn();

vi.mock('../lib/integrations/stripe', () => ({
  getStripe: vi.fn().mockReturnValue({
    checkout: {
      sessions: { create: mockStripeCreate, retrieve: mockStripeRetrieve },
    },
    prices: { retrieve: mockPriceRetrieve, list: mockPriceList },
    subscriptions: { list: vi.fn().mockResolvedValue({ data: [] }) },
    customers: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      search: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({ id: 'cus_router_created' }),
      del: vi.fn().mockResolvedValue({ deleted: true }),
    },
  }),
}));

vi.mock('./middleware/RequireAuthentication', () => {
  const middleware = (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    res.locals.owner = 42;
    res.locals.email = 'test@example.com';
    next();
  };
  return { __esModule: true, default: middleware };
});

let mockOptionalOwner: number | undefined;
let mockOptionalEmail: string | undefined;

// The duplicate-purchase guard reads what the caller already owns, so the
// router now touches the database on every authenticated checkout.
let mockHeldPatreon = false;
let mockHeldSubscriber = false;
let mockHeldPass: {
  kind: string;
  expires_at: Date;
  stripe_payment_intent_id: string;
} | null = null;

vi.mock('../data_layer', () => ({ getDatabase: () => ({}) }));

vi.mock('../lib/misc/hashToken', () => ({
  default: (value: string) => `hashed:${value}`,
}));

vi.mock('../data_layer/UsersRepository', () => ({
  __esModule: true,
  default: class {
    async getById() {
      return { email: 'test@example.com', patreon: mockHeldPatreon };
    }
    async getStripeCustomerId() {
      return 'cus_router_test';
    }
    async claimStripeCustomerId(_id: number, candidate: string) {
      return candidate;
    }
  },
}));

vi.mock('../data_layer/UserPassRepository', () => ({
  __esModule: true,
  default: class {
    async findActive() {
      return mockHeldPass;
    }
  },
}));

vi.mock('../services/AuthenticationService', () => ({
  __esModule: true,
  default: class {
    async getIsSubscriber() {
      return mockHeldSubscriber;
    }
  },
}));

vi.mock('./middleware/optionalAuthMiddleware', () => ({
  optionalAuthMiddleware: (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (mockOptionalOwner != null) res.locals.owner = mockOptionalOwner;
    if (mockOptionalEmail != null) res.locals.email = mockOptionalEmail;
    next();
  },
}));

async function buildServer() {
  const { default: CheckoutRouter } = await import('./CheckoutRouter');
  const app = express();
  app.use(express.json());
  app.use(CheckoutRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe('CheckoutRouter — pass routes', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.AUTO_SYNC_PRICE_ID = 'price_auto_sync_test';
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => {
    mockStripeCreate.mockReset();
    delete process.env.PASS_24H_PRICE_ID;
    delete process.env.PASS_7D_PRICE_ID;
    delete process.env.PASS_120D_PRICE_ID;
    mockOptionalOwner = undefined;
    mockOptionalEmail = undefined;
    mockHeldPatreon = false;
    mockHeldSubscriber = false;
    mockHeldPass = null;
  });

  describe('duplicate-purchase guard', () => {
    beforeEach(() => {
      process.env.PASS_24H_PRICE_ID = 'price_24h_test';
      mockStripeCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/should-not-be-reached',
      });
    });

    it('answers 409 when a pass holder buys a second pass', async () => {
      mockOptionalOwner = 42;
      mockHeldPass = {
        kind: '7d',
        expires_at: new Date('2026-10-08T00:00:00.000Z'),
        stripe_payment_intent_id: 'pi_stripe',
      };

      const res = await fetch(`${url}/api/checkout/pass/24h`, {
        method: 'POST',
      });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        code: 'pass_still_active',
        message:
          'Your pass is still running. Buy the next one when it runs out.',
        expiresAt: '2026-10-08T00:00:00.000Z',
      });
      expect(mockStripeCreate).not.toHaveBeenCalled();
    });

    it('answers 409 when a subscriber buys Pro again', async () => {
      mockHeldSubscriber = true;

      const res = await fetch(`${url}/api/checkout/unlimited`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interval: 'month' }),
      });

      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('already_subscribed');
      expect(mockStripeCreate).not.toHaveBeenCalled();
    });

    it.each([
      ['a lifetime holder', 'already_lifetime', () => (mockHeldPatreon = true)],
      [
        'an Apple subscriber',
        'billed_through_apple',
        () =>
          (mockHeldPass = {
            kind: 'unlimited',
            expires_at: new Date('2026-11-08T00:00:00.000Z'),
            stripe_payment_intent_id: 'apple:txn',
          }),
      ],
    ])('answers 409 when %s buys Auto Sync', async (_who, code, hold) => {
      hold();

      const res = await fetch(`${url}/api/checkout/auto-sync`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe(code);
      expect(mockStripeCreate).not.toHaveBeenCalled();
    });

    it('still lets an anonymous caller buy a pass', async () => {
      mockHeldSubscriber = true;

      const res = await fetch(`${url}/api/checkout/pass/24h`, {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      expect(mockStripeCreate).toHaveBeenCalled();
    });
  });

  describe('POST /api/checkout/pass/24h', () => {
    it('reuses the account customer for an authenticated buyer', async () => {
      process.env.PASS_24H_PRICE_ID = 'price_24h_test';
      mockOptionalOwner = 42;
      mockOptionalEmail = 'test@example.com';
      mockStripeCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/24h-auth',
      });

      const res = await fetch(`${url}/api/checkout/pass/24h`, {
        method: 'POST',
      });

      expect(res.status).toBe(200);
      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_router_test',
          customer_email: undefined,
        })
      );
    });

    it('returns 503 when PASS_24H_PRICE_ID env var is not set', async () => {
      const res = await fetch(`${url}/api/checkout/pass/24h`, {
        method: 'POST',
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.message).toBe('Day Pass is not available right now.');
    });

    it('returns checkout url for anonymous user (no auth cookie)', async () => {
      process.env.PASS_24H_PRICE_ID = 'price_24h_test';
      mockStripeCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/24h',
      });

      const res = await fetch(`${url}/api/checkout/pass/24h`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.url).toBe('https://checkout.stripe.com/24h');
    });

    it('anonymous mode sets pass_anonymous=1 in metadata and session-id success_url', async () => {
      process.env.PASS_24H_PRICE_ID = 'price_24h_test';
      mockStripeCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/24h',
      });

      await fetch(`${url}/api/checkout/pass/24h`, { method: 'POST' });
      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            pass_kind: '24h',
            pass_anonymous: '1',
          }),
          success_url: expect.stringContaining('{CHECKOUT_SESSION_ID}'),
        })
      );
    });

    it('authenticated mode sets user_id in metadata', async () => {
      process.env.PASS_24H_PRICE_ID = 'price_24h_test';
      mockOptionalOwner = 42;
      mockOptionalEmail = 'test@example.com';
      mockStripeCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/24h-auth',
      });

      const res = await fetch(`${url}/api/checkout/pass/24h`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            user_id: '42',
            pass_kind: '24h',
          }),
        })
      );
    });

    it('passes pass_kind=24h in session metadata', async () => {
      process.env.PASS_24H_PRICE_ID = 'price_24h_test';
      mockStripeCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/24h',
      });

      await fetch(`${url}/api/checkout/pass/24h`, { method: 'POST' });
      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ pass_kind: '24h' }),
        })
      );
    });
  });

  describe('POST /api/checkout/pass/7d', () => {
    it('returns 503 when PASS_7D_PRICE_ID env var is not set', async () => {
      const res = await fetch(`${url}/api/checkout/pass/7d`, {
        method: 'POST',
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.message).toBe('Week Pass is not available right now.');
    });

    it('returns checkout url when env var is set', async () => {
      process.env.PASS_7D_PRICE_ID = 'price_7d_test';
      mockStripeCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/7d',
      });

      const res = await fetch(`${url}/api/checkout/pass/7d`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.url).toBe('https://checkout.stripe.com/7d');
    });

    it('passes pass_kind=7d in session metadata', async () => {
      process.env.PASS_7D_PRICE_ID = 'price_7d_test';
      mockStripeCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/7d',
      });

      await fetch(`${url}/api/checkout/pass/7d`, { method: 'POST' });
      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ pass_kind: '7d' }),
        })
      );
    });
  });

  describe('POST /api/checkout/pass/120d', () => {
    it('returns 503 when PASS_120D_PRICE_ID env var is not set', async () => {
      const res = await fetch(`${url}/api/checkout/pass/120d`, {
        method: 'POST',
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.message).toBe('Semester Pass is not available right now.');
    });

    it('returns checkout url when env var is set', async () => {
      process.env.PASS_120D_PRICE_ID = 'price_120d_test';
      mockStripeCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/120d',
      });

      const res = await fetch(`${url}/api/checkout/pass/120d`, {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.url).toBe('https://checkout.stripe.com/120d');
    });

    it('passes pass_kind=120d in session metadata', async () => {
      process.env.PASS_120D_PRICE_ID = 'price_120d_test';
      mockStripeCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/120d',
      });

      await fetch(`${url}/api/checkout/pass/120d`, { method: 'POST' });
      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ pass_kind: '120d' }),
        })
      );
    });

    it('uses the PASS_120D_PRICE_ID as the checkout line item', async () => {
      process.env.PASS_120D_PRICE_ID = 'price_120d_test';
      mockStripeCreate.mockResolvedValue({
        url: 'https://checkout.stripe.com/120d',
      });

      await fetch(`${url}/api/checkout/pass/120d`, { method: 'POST' });
      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: 'price_120d_test', quantity: 1 }],
        })
      );
    });
  });

  describe('GET /api/pricing', () => {
    it('responds 200 with a passes object', async () => {
      const res = await fetch(`${url}/api/pricing`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('passes');
      expect(typeof body.passes).toBe('object');
    });

    it('sets a public, cacheable Cache-Control header', async () => {
      const res = await fetch(`${url}/api/pricing`);
      const cacheControl = res.headers.get('cache-control');
      expect(cacheControl).toContain('public');
      expect(cacheControl).toContain('max-age=');
    });

    it('omits passes when Stripe amounts cannot be resolved', async () => {
      const res = await fetch(`${url}/api/pricing`);
      const body = await res.json();
      expect(body.passes).toEqual({});
    });
  });
});

describe('CheckoutRouter — GET /api/checkout/auto-sync/price', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    process.env.AUTO_SYNC_PRICE_ID = 'price_auto_sync_test';
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  it('serves the live Stripe price for the configured Auto Sync price', async () => {
    mockPriceRetrieve.mockResolvedValue({
      active: true,
      unit_amount: 3000,
      currency: 'usd',
      recurring: { interval: 'month' },
    });

    const res = await fetch(`${url}/api/checkout/auto-sync/price`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      amount: 3000,
      currency: 'usd',
      interval: 'month',
      display: '$30',
    });
    expect(mockPriceRetrieve).toHaveBeenCalledWith('price_auto_sync_test');
  });
});

describe('CheckoutRouter — GET /api/checkout/receipt', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    process.env.AUTO_SYNC_PRICE_ID = 'price_auto_sync_test';
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => {
    mockStripeRetrieve.mockReset();
    mockOptionalOwner = undefined;
    mockOptionalEmail = undefined;
  });

  it('returns the receipt for an anonymous pass session without a login', async () => {
    mockStripeRetrieve.mockResolvedValue({
      id: 'cs_test_a1B2c3D4e5F6g7',
      payment_status: 'paid',
      amount_total: 600,
      currency: 'usd',
      mode: 'payment',
      metadata: { pass_anonymous: '1', pass_kind: '24h' },
    });

    const res = await fetch(
      `${url}/api/checkout/receipt?session_id=cs_test_a1B2c3D4e5F6g7`
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      amount: 600,
      currency: 'USD',
      kind: 'pass_24h',
      anonymous: true,
    });
    expect(mockStripeRetrieve).toHaveBeenCalledWith('cs_test_a1B2c3D4e5F6g7');
  });

  it('hides another user\u2019s session as 404', async () => {
    mockOptionalOwner = 7;
    mockStripeRetrieve.mockResolvedValue({
      id: 'cs_test_a1B2c3D4e5F6g7',
      payment_status: 'paid',
      amount_total: 2900,
      currency: 'usd',
      mode: 'payment',
      metadata: { user_id: '42', pass_kind: '120d' },
    });

    const res = await fetch(
      `${url}/api/checkout/receipt?session_id=cs_test_a1B2c3D4e5F6g7`
    );

    expect(res.status).toBe(404);
  });

  it('rejects a malformed session id with 400 and never calls Stripe', async () => {
    const res = await fetch(`${url}/api/checkout/receipt?session_id=nope`);

    expect(res.status).toBe(400);
    expect(mockStripeRetrieve).not.toHaveBeenCalled();
  });
});

describe('CheckoutRouter — Pro prices with no pricing flag row', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => {
    mockStripeCreate.mockReset();
    mockPriceList.mockReset();
    mockOptionalOwner = undefined;
    mockHeldPatreon = false;
    mockHeldSubscriber = false;
    mockHeldPass = null;
    clearResolvedPriceIdCache();
  });

  it.each(['24h', '7d', '120d'])(
    'sells a %s pass holder moving to Pro the v2 price',
    async (kind) => {
      mockHeldPass = {
        kind,
        expires_at: new Date('2026-11-08T00:00:00.000Z'),
        stripe_payment_intent_id: 'pi_stripe',
      };
      mockPriceList.mockResolvedValue({ data: [{ id: 'price_v2_monthly' }] });
      mockStripeCreate.mockResolvedValue({
        id: 'cs_v2',
        url: 'https://checkout.stripe.com/v2',
      });

      const res = await fetch(`${url}/api/checkout/unlimited`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interval: 'month' }),
      });

      expect(res.status).toBe(200);
      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: 'price_v2_monthly', quantity: 1 }],
        })
      );
    }
  );

  it.each([
    ['month', 'v2_monthly', 'price_v2_monthly'],
    ['year', 'v2_annual', 'price_v2_annual'],
  ])(
    'sells a new %s checkout at the v2 price',
    async (interval, lookupKey, priceId) => {
      mockPriceList.mockResolvedValue({ data: [{ id: priceId }] });
      mockStripeCreate.mockResolvedValue({
        id: 'cs_v2',
        url: 'https://checkout.stripe.com/v2',
      });

      const res = await fetch(`${url}/api/checkout/unlimited`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ interval }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        url: 'https://checkout.stripe.com/v2',
      });
      expect(mockPriceList).toHaveBeenCalledWith({
        lookup_keys: [lookupKey],
        active: true,
        limit: 1,
      });
      expect(mockStripeCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          line_items: [{ price: priceId, quantity: 1 }],
          metadata: expect.objectContaining({ cohort: 'v2', interval }),
        })
      );
    }
  );

  it('quotes v2 prices on GET /api/checkout/prices', async () => {
    const res = await fetch(`${url}/api/checkout/prices`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      cohort: 'v2',
      legacy: false,
      monthly: { cents: 799 },
      annual: { cents: 6400 },
      lockInDeadline: null,
    });
  });
});
