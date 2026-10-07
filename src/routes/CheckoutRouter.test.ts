import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

const mockStripeCreate = vi.fn();

vi.mock('../lib/integrations/stripe', () => ({
  getStripe: vi.fn().mockReturnValue({
    checkout: {
      sessions: { create: mockStripeCreate },
    },
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
    // The router captures this at construction, unlike the pass price ids,
    // which resolve per request.
    process.env.UNLIMITED_MONTHLY_PRICE_ID = 'price_unlimited_test';
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
