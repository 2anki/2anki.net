import { vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';

vi.mock('../lib/integrations/stripe', () => ({
  getStripe: vi.fn(() => ({
    products: {
      list: vi.fn().mockResolvedValue({
        data: [{ id: 'prod_unlimited', name: 'Unlimited' }],
      }),
      create: vi.fn().mockImplementation(async (params) => ({
        id: 'prod_created',
        metadata: params?.metadata ?? {},
      })),
    },
    prices: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn().mockResolvedValue({ id: 'price_new', livemode: false }),
    },
  })),
}));

vi.mock('../services/events/eventsSinkInstance', () => ({
  getEventsSink: () => ({ record: vi.fn() }),
}));

const featureFlagStore: Array<{
  key: string;
  value: boolean;
  description: string | null;
  updated_at: Date | null;
  updated_by: number | null;
  email: string | null;
}> = [];

vi.mock('../data_layer', () => ({
  getDatabase: vi.fn(() => ({
    raw: vi.fn(),
  })),
}));

vi.mock('../data_layer/FeatureFlagsRepository', () => {
  class FakeFeatureFlagsRepository {
    async getAll() {
      return featureFlagStore.map((row) => ({
        key: row.key,
        value: row.value,
        description: row.description,
        updated_at:
          row.updated_at == null ? null : row.updated_at.toISOString(),
        updated_by: row.updated_by,
        updated_by_email: row.email,
      }));
    }
    async get(key: string) {
      const row = featureFlagStore.find((r) => r.key === key);
      return row == null ? null : row.value;
    }
    async set(key: string, value: boolean, userId: number) {
      const idx = featureFlagStore.findIndex((r) => r.key === key);
      if (idx === -1) return null;
      featureFlagStore[idx] = {
        ...featureFlagStore[idx],
        value,
        updated_by: userId,
        updated_at: new Date('2026-05-30T12:00:00Z'),
      };
      const row = featureFlagStore[idx];
      return {
        key: row.key,
        value: row.value,
        description: row.description,
        updated_at:
          row.updated_at == null ? null : row.updated_at.toISOString(),
        updated_by: row.updated_by,
        updated_by_email: row.email,
      };
    }
  }
  return { FeatureFlagsRepository: FakeFeatureFlagsRepository };
});

vi.mock('../services/events/track', () => ({
  track: vi.fn(),
}));

vi.mock('../data_layer/OrphanedSubscriptionsRepository', () => ({
  OrphanedSubscriptionsRepository: class {
    async findOrphanedActiveSubscriptions() {
      return [
        {
          id: 9,
          email: 'payer@example.com',
          stripe_product_id: 'prod_unlimited',
          created_at: new Date('2026-05-01T00:00:00.000Z'),
          customer_id: 'cus_123',
        },
      ];
    }
  },
}));

vi.mock('../data_layer/SubscriptionRecoveryNotificationsRepository', () => ({
  SubscriptionRecoveryNotificationsRepository: class {
    async wasNotifiedSince() {
      return false;
    }
    async recordNotified() {}
  },
}));

vi.mock('../services/EmailService/EmailService', () => ({
  getDefaultEmailService: () => ({
    sendInactivityWarningEmail: vi.fn().mockResolvedValue(undefined),
    sendPriceLockInEmail: vi.fn().mockResolvedValue(undefined),
    sendSubscriptionRecoveryEmail: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('./middleware/RequireOpsAccess', () => {
  const state = globalThis as unknown as {
    __opsAccessState?: { allow: boolean };
  };
  if (state.__opsAccessState == null) {
    state.__opsAccessState = { allow: false };
  }
  const sharedState = state.__opsAccessState;
  return {
    __esModule: true,
    default: (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (!sharedState.allow) {
        res.status(404).end();
        return;
      }
      res.locals.owner = 1;
      res.locals.email = 'alex@example.com';
      next();
    },
    makeRequireOpsAccess: vi.fn(),
  };
});

vi.mock('../services/ops/BusinessMetricsService', () => {
  return {
    BusinessMetricsService: class {
      async getMetrics() {
        return {
          mrr_usd: 4820,
          net_new_mrr_mtd_usd: 312,
          active_paying_subs: 184,
          churn_30d_pct: 2.1,
          failed_payments_7d: 4,
          new_paid_conversions_7d: 11,
          as_of: '2026-05-09T14:32:07.000Z',
          cache_age_seconds: 0,
        };
      }
    },
  };
});

vi.mock('../services/ops/ConversionMetricsService', () => {
  return {
    ConversionMetricsService: class {
      async getMetrics() {
        return {
          free_conversions_7d: 342,
          paid_conversions_7d: 89,
          free_conversion_success_rate_7d: 87.5,
          paid_conversion_success_rate_7d: 94.2,
          conversion_errors_7d_top_reasons: [
            { reason: 'Empty page', count: 12 },
            { reason: 'Network timeout', count: 5 },
          ],
          failed_conversions_weekly: [
            { week: '2026-05-04', count: 3 },
            { week: '2026-05-11', count: 8 },
          ],
          new_accounts_downloaded_24h_rate_30d: 50,
          new_accounts_downloaded_after_signup_24h_rate_30d: 12,
          upload_to_download_rate_7d: 25,
        };
      }
    },
  };
});

vi.mock('../services/ops/TodaySnapshotService', () => {
  return {
    TodaySnapshotService: class {
      async getSnapshot() {
        return {
          rows: [
            {
              id: 'new_paid_7d',
              lever: 'revenue',
              label: 'New paid',
              format: 'count',
              window_label: '7d',
              value: 15,
              delta: null,
              delta_good: null,
              target: 70,
              target_direction: 'at_least',
              status: 'red',
              link: '/ops/business',
            },
          ],
          as_of: '2026-09-09T10:00:00.000Z',
          cache_age_seconds: 0,
          stale: false,
          errors: [],
        };
      }
    },
  };
});

vi.mock('../lib/storage/StorageHandler', () => {
  return {
    __esModule: true,
    default: class {
      listMindmapObjects() {
        return Promise.resolve([]);
      }
    },
  };
});

vi.mock('../lib/storage/jobs/helpers/updateStripeSubscriptions', () => ({
  updateStripeSubscriptions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../data_layer/EventsRepository', () => {
  return {
    __esModule: true,
    default: class {
      groupUploadFunnel() {
        return Promise.resolve([
          { stage: 'upload_started', distinct_identities: 100 },
          { stage: 'conversion_succeeded', distinct_identities: 72 },
          { stage: 'conversion_failed', distinct_identities: 20 },
          { stage: 'deck_downloaded', distinct_identities: 60 },
        ]);
      }
      groupUploadFunnelByOrigin() {
        return Promise.resolve([
          {
            origin: '/nclex',
            stage: 'upload_started',
            distinct_identities: 60,
          },
          {
            origin: '/nclex',
            stage: 'deck_downloaded',
            distinct_identities: 40,
          },
        ]);
      }
      groupPaywallShownByVariantAndSurface() {
        return Promise.resolve([]);
      }
      groupPaywallClicksByVariant() {
        return Promise.resolve([]);
      }
      groupConversionFailedByReason() {
        return Promise.resolve({ paywall: 8, empty: 5, technical: 7 });
      }
    },
  };
});

import OpsRouter from './OpsRouter';

const opsAccessState = (
  globalThis as unknown as {
    __opsAccessState: { allow: boolean };
  }
).__opsAccessState;

const setOwnerAccess = (allow: boolean) => {
  opsAccessState.allow = allow;
};

const startServer = async (allowOps: boolean = false) => {
  setOwnerAccess(allowOps);
  const app = express();
  app.use(express.json());
  app.use(OpsRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
};

describe('OpsRouter access control', () => {
  let shared: Awaited<ReturnType<typeof startServer>>;

  beforeAll(async () => {
    shared = await startServer(false);
  });

  afterAll(async () => {
    await shared.close();
  });

  const jsonRequest = (body: Record<string, unknown> | undefined) =>
    body == null
      ? undefined
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        };

  const nonOwnerRoutes: Array<
    [string, string, Record<string, unknown> | undefined]
  > = [
    ['GET', '/api/ops/business/metrics', undefined],
    ['POST', '/api/ops/sync-stripe-subscriptions', undefined],
    ['GET', '/api/ops/upload-funnel', undefined],
    ['GET', '/api/ops/today', undefined],
    ['GET', '/api/ops/conversion/metrics', undefined],
    ['GET', '/api/ops/flags', undefined],
    ['PUT', '/api/ops/flags/ai-converter-floor-v1', { value: true }],
    ['GET', '/api/ops/subscriptions/orphaned', undefined],
    ['POST', '/api/ops/subscriptions/reconcile', undefined],
  ];

  it.each(nonOwnerRoutes)(
    'returns 404 for non-owner callers: %s %s',
    async (method, path, body) => {
      setOwnerAccess(false);
      const response = await fetch(`${shared.url}${path}`, {
        method,
        ...jsonRequest(body),
      });
      expect(response.status).toBe(404);
    }
  );

  const retiredRoutes: Array<[string, Record<string, unknown> | undefined]> = [
    ['/api/ops/create-pricing-v2-prices', undefined],
    ['/api/ops/send-price-lock-in-emails', { dryRun: true }],
    [
      '/api/ops/send-abandoned-checkout-recovery',
      { emails: ['user@example.com'], dryRun: true },
    ],
    ['/api/ops/archive-legacy-prices', { dryRun: true }],
  ];

  it.each(retiredRoutes)(
    'returns 404 for the ops owner because %s is retired',
    async (path, body) => {
      setOwnerAccess(true);
      const response = await fetch(`${shared.url}${path}`, {
        method: 'POST',
        ...jsonRequest(body),
      });
      expect(response.status).toBe(404);
    }
  );
});

describe('OpsRouter /api/ops/business/metrics', () => {
  it('sets Cache-Control no-store on ops endpoints so browsers never serve stale dashboard data', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(`${url}/api/ops/performance/metrics`);
      expect(response.headers.get('cache-control')).toBe('no-store');
    } finally {
      await close();
    }
  });

  it('lets business metrics keep its deliberate day-long cache header', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(`${url}/api/ops/business/metrics`);
      expect(response.headers.get('cache-control')).toBe(
        'private, max-age=86400'
      );
    } finally {
      await close();
    }
  });

  it('returns 200 with the business metrics shape for the ops owner', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(`${url}/api/ops/business/metrics`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(
        expect.objectContaining({
          mrr_usd: expect.any(Number),
          net_new_mrr_mtd_usd: expect.any(Number),
          active_paying_subs: expect.any(Number),
          churn_30d_pct: expect.any(Number),
          failed_payments_7d: expect.any(Number),
          new_paid_conversions_7d: expect.any(Number),
          as_of: expect.any(String),
          cache_age_seconds: expect.any(Number),
        })
      );
    } finally {
      await close();
    }
  });
});

describe('OpsRouter /api/ops/sync-stripe-subscriptions', () => {
  it('returns 202 and starts the sync for the ops owner', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(`${url}/api/ops/sync-stripe-subscriptions`, {
        method: 'POST',
      });
      expect(response.status).toBe(202);
      const body = await response.json();
      expect(body).toEqual(
        expect.objectContaining({ message: expect.any(String) })
      );
    } finally {
      await close();
    }
  });
});

describe('OpsRouter /api/ops/upload-funnel', () => {
  it('returns 200 with stage counts and success rate for the ops owner', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(`${url}/api/ops/upload-funnel`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(
        expect.objectContaining({
          stages: expect.objectContaining({
            upload_started: 100,
            conversion_succeeded: 72,
            conversion_failed: 20,
            deck_downloaded: 60,
          }),
          upload_to_download_rate_pct: 60,
          conversion_failed_by_reason: {
            paywall: 8,
            empty: 5,
            technical: 7,
          },
          by_origin: [
            expect.objectContaining({
              origin: '/nclex',
              upload_to_download_rate_pct: expect.any(Number),
            }),
          ],
          since: expect.any(String),
          as_of: expect.any(String),
        })
      );
    } finally {
      await close();
    }
  });
});

describe('OpsRouter /api/ops/today', () => {
  it('returns the scored snapshot for the ops owner', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(`${url}/api/ops/today`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(
        expect.objectContaining({
          as_of: '2026-09-09T10:00:00.000Z',
          stale: false,
          rows: [expect.objectContaining({ id: 'new_paid_7d', status: 'red' })],
        })
      );
    } finally {
      await close();
    }
  });
});

describe('OpsRouter /api/ops/conversion/metrics', () => {
  it('returns 200 with the conversion metrics shape for the ops owner', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(`${url}/api/ops/conversion/metrics`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual(
        expect.objectContaining({
          free_conversions_7d: expect.any(Number),
          paid_conversions_7d: expect.any(Number),
          free_conversion_success_rate_7d: expect.any(Number),
          paid_conversion_success_rate_7d: expect.any(Number),
          conversion_errors_7d_top_reasons: expect.any(Array),
          failed_conversions_weekly: expect.any(Array),
          new_accounts_downloaded_24h_rate_30d: expect.any(Number),
          new_accounts_downloaded_after_signup_24h_rate_30d: expect.any(Number),
          upload_to_download_rate_7d: expect.any(Number),
        })
      );
    } finally {
      await close();
    }
  });
});

describe('OpsRouter /api/ops/flags', () => {
  beforeEach(() => {
    featureFlagStore.length = 0;
    featureFlagStore.push({
      key: 'ai-converter-floor-v1',
      value: false,
      description: 'desc',
      updated_at: new Date('2026-05-29T10:00:00Z'),
      updated_by: 1,
      email: 'alex@example.com',
    });
  });

  it('GET returns the seeded flag with updated_by_email but no updated_by id', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(`${url}/api/ops/flags`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual([
        {
          key: 'ai-converter-floor-v1',
          value: false,
          description: 'desc',
          updated_at: '2026-05-29T10:00:00.000Z',
          updated_by_email: 'alex@example.com',
        },
      ]);
    } finally {
      await close();
    }
  });

  it('PUT returns 400 when the body value is not a boolean', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(
        `${url}/api/ops/flags/ai-converter-floor-v1`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: 'yes' }),
        }
      );
      expect(response.status).toBe(400);
    } finally {
      await close();
    }
  });

  it('PUT returns 404 when the flag key does not exist', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(`${url}/api/ops/flags/missing-key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: true }),
      });
      expect(response.status).toBe(404);
    } finally {
      await close();
    }
  });

  it('PUT updates the flag and returns the updated row', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(
        `${url}/api/ops/flags/ai-converter-floor-v1`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: true }),
        }
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        key: 'ai-converter-floor-v1',
        value: true,
        updated_by_email: 'alex@example.com',
      });
      expect(body).not.toHaveProperty('updated_by');
    } finally {
      await close();
    }
  });
});

describe('OpsRouter /api/ops/subscriptions/orphaned', () => {
  it('returns 200 with the orphan count and a typed list for the ops owner', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(`${url}/api/ops/subscriptions/orphaned`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        count: 1,
        orphans: [
          {
            id: 9,
            email: 'payer@example.com',
            stripeProductId: 'prod_unlimited',
            createdAt: '2026-05-01T00:00:00.000Z',
            customerId: 'cus_123',
          },
        ],
      });
    } finally {
      await close();
    }
  });
});

describe('OpsRouter /api/ops/subscriptions/reconcile', () => {
  it('returns 200 with the reconcile summary for the ops owner', async () => {
    const { url, close } = await startServer(true);
    try {
      const response = await fetch(`${url}/api/ops/subscriptions/reconcile`, {
        method: 'POST',
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        found: 1,
        emailed: 1,
        skippedRecentlyNotified: 0,
        skippedNoEmail: 0,
      });
    } finally {
      await close();
    }
  });
});
