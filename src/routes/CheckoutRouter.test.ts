import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

const mockStripeCreate = jest.fn();

jest.mock('../lib/integrations/stripe', () => ({
  getStripe: jest.fn().mockReturnValue({
    checkout: {
      sessions: { create: mockStripeCreate },
    },
  }),
}));

jest.mock('./middleware/RequireAuthentication', () => {
  const middleware = (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    res.locals.owner = 42;
    res.locals.email = 'test@example.com';
    next();
  };
  return middleware;
});

let mockOptionalOwner: number | undefined;
let mockOptionalEmail: string | undefined;

jest.mock('./middleware/optionalAuthMiddleware', () => ({
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
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
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
  });

  describe('POST /api/checkout/pass/24h', () => {
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
