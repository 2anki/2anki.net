import express from 'express';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { InMemoryUserPassRepository } from '../data_layer/UserPassRepository';
import { InMemoryAnonymousPassRepository } from '../data_layer/AnonymousPassRepository';
import { emailHash } from '../lib/emailHash';

const mockUpsert = jest.fn();
const inMemoryRepo = new InMemoryUserPassRepository();

const mockAnonInsert = jest.fn();
const inMemoryAnonRepo = new InMemoryAnonymousPassRepository();

const mockCustomersRetrieve = jest.fn();
const mockSessionsRetrieve = jest.fn();

jest.mock('../lib/integrations/stripe', () => ({
  getStripe: jest.fn().mockReturnValue({
    webhooks: {
      constructEvent: jest.fn(
        (_body: Buffer, _sig: string) => mockWebhookEvent
      ),
    },
    customers: { retrieve: mockCustomersRetrieve },
    checkout: { sessions: { retrieve: mockSessionsRetrieve } },
  }),
  getCustomerId: jest.fn().mockReturnValue('cus_abc'),
  extractProductId: jest.fn().mockReturnValue('prod_test'),
  updateStoreSubscription: jest
    .fn()
    .mockResolvedValue({ status: 'linked', resolvedUserId: 1 }),
}));

jest.mock('../data_layer', () => ({ getDatabase: jest.fn() }));

const mockClaimSession = jest.fn().mockResolvedValue(true);
const mockIsMarketingOptedOut = jest.fn().mockResolvedValue(false);
const mockHasLifetimeOrActiveSubscription = jest.fn().mockResolvedValue(false);
const mockHasSendSince = jest.fn().mockResolvedValue(false);
jest.mock('../data_layer/AbandonedCheckoutRecoveryRepository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    claimSession: mockClaimSession,
    isMarketingOptedOut: mockIsMarketingOptedOut,
    hasLifetimeOrActiveSubscription: mockHasLifetimeOrActiveSubscription,
    hasSendSince: mockHasSendSince,
  })),
}));

const mockSendAbandonedCheckoutRecoveryEmail = jest
  .fn()
  .mockResolvedValue(undefined);
jest.mock('../services/EmailService/EmailService', () => ({
  getDefaultEmailService: jest.fn().mockReturnValue({
    sendAbandonedCheckoutRecoveryEmail: mockSendAbandonedCheckoutRecoveryEmail,
    sendResetEmail: jest.fn(),
    sendConversionEmail: jest.fn(),
    sendConversionLinkEmail: jest.fn(),
    sendContactEmail: jest.fn(),
    sendSubscriptionCancelledEmail: jest.fn(),
    sendSubscriptionScheduledCancellationEmail: jest.fn(),
    sendHostedAnkiAccessRequestEmail: jest.fn(),
    sendMagicLinkEmail: jest.fn(),
    sendReEngagementEmail: jest.fn(),
    sendInactivityWarningEmail: jest.fn(),
    sendParserCanaryAlert: jest.fn(),
    sendNotionReconnectEmail: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionClaimConfirmation: jest.fn().mockResolvedValue(undefined),
    sendPassClaimConfirmation: jest.fn().mockResolvedValue(undefined),
    sendPriceLockInEmail: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionRecoveryEmail: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('../data_layer/UserPassRepository', () => {
  const { InMemoryUserPassRepository: Mem } = jest.requireActual(
    '../data_layer/UserPassRepository'
  );
  return {
    __esModule: true,
    default: jest
      .fn()
      .mockImplementation(() => ({ upsertWithExtension: mockUpsert })),
    InMemoryUserPassRepository: Mem,
  };
});

jest.mock('../data_layer/AnonymousPassRepository', () => {
  const { InMemoryAnonymousPassRepository: AnonMem } = jest.requireActual(
    '../data_layer/AnonymousPassRepository'
  );
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({ insert: mockAnonInsert })),
    InMemoryAnonymousPassRepository: AnonMem,
  };
});

const mockUpdatePatreonByEmail = jest.fn();
jest.mock('../data_layer/UsersRepository', () =>
  jest.fn().mockImplementation(() => ({
    updatePatreonByEmail: mockUpdatePatreonByEmail,
  }))
);

jest.mock('../lib/misc/hashToken', () => (s: string) => `hashed:${s}`);

jest.mock('../services/GA4Service', () => ({
  sendPurchaseEvent: jest.fn().mockResolvedValue(undefined),
}));

const mockTrack = jest.fn();
jest.mock('../services/events/track', () => ({
  track: (...args: unknown[]) => mockTrack(...args),
}));

const mockRecordError = jest.fn().mockResolvedValue(undefined);
jest.mock('../data_layer/UserVisibleErrorsRepository', () => ({
  UserVisibleErrorsRepository: jest.fn().mockImplementation(() => ({
    record: jest.fn().mockResolvedValue(undefined),
    countBySurfaceAndCode: jest.fn().mockResolvedValue([]),
  })),
}));
jest.mock('../usecases/observability/RecordUserVisibleErrorUseCase', () => ({
  RecordUserVisibleErrorUseCase: jest.fn().mockImplementation(() => ({
    execute: mockRecordError,
  })),
}));

let mockWebhookEvent: {
  type: string;
  data: { object: Record<string, unknown> };
};

async function buildServer() {
  const { default: WebhooksRouter } = await import('./WebhookRouter');
  const app = express();
  app.use(WebhooksRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

function makePassSessionEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test',
        amount_total: 400,
        currency: 'usd',
        customer: null,
        payment_intent: 'pi_test_123',
        metadata: { user_id: '42', pass_kind: '24h' },
        ...overrides,
      },
    },
  };
}

describe('WebhookRouter — pass grant', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function postWebhook() {
    return fetch(`${url}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify({}),
    });
  }

  it('grants 24h pass on checkout.session.completed with pass_kind=24h', async () => {
    mockWebhookEvent = makePassSessionEvent();
    mockUpsert.mockResolvedValue({
      id: 1,
      user_id: 42,
      kind: '24h',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      stripe_payment_intent_id: 'pi_test_123',
    });

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      42,
      '24h',
      24 * 60 * 60 * 1000,
      'pi_test_123',
      expect.any(Date)
    );
  });

  it('grants 7d pass on checkout.session.completed with pass_kind=7d', async () => {
    mockWebhookEvent = makePassSessionEvent({
      metadata: { user_id: '7', pass_kind: '7d' },
      payment_intent: 'pi_7d',
    });
    mockUpsert.mockResolvedValue({
      id: 2,
      user_id: 7,
      kind: '7d',
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      stripe_payment_intent_id: 'pi_7d',
    });

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      7,
      '7d',
      7 * 24 * 60 * 60 * 1000,
      'pi_7d',
      expect.any(Date)
    );
  });

  it('returns 200 without calling upsert when user_id metadata is missing', async () => {
    mockWebhookEvent = makePassSessionEvent({ metadata: { pass_kind: '24h' } });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'pass.webhook.missing_metadata',
      expect.anything()
    );
    warnSpy.mockRestore();
  });

  it('returns 200 without calling upsert when user_id is not a valid integer', async () => {
    mockWebhookEvent = makePassSessionEvent({
      metadata: { user_id: 'not-a-number', pass_kind: '24h' },
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockUpsert).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('logs pass.granted with hashed payment intent (not raw)', async () => {
    mockWebhookEvent = makePassSessionEvent();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    mockUpsert.mockResolvedValue({
      id: 1,
      user_id: 42,
      kind: '24h',
      expires_at: expiresAt,
      stripe_payment_intent_id: 'pi_test_123',
    });
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    await postWebhook();
    const passGrantedCall = infoSpy.mock.calls.find(
      ([msg]) => msg === 'pass.granted'
    );
    expect(passGrantedCall).toBeDefined();
    const logData = passGrantedCall?.[1] as Record<string, unknown>;
    expect(logData.payment_intent_id_hash).toBe('hashed:pi_test_123');
    expect(logData).not.toHaveProperty('pi_test_123');
    infoSpy.mockRestore();
  });

  it('does not call upsert for non-pass checkout sessions', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_lifetime',
          amount_total: 9600,
          currency: 'usd',
          customer: 'cus_abc',
          payment_intent: null,
          metadata: { user_id: '1' },
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('persists anonymous pass on checkout.session.completed with pass_anonymous=1', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_anon_test',
          amount_total: 400,
          currency: 'usd',
          customer: null,
          payment_intent: 'pi_anon_456',
          customer_details: { email: 'Buyer@Example.com' },
          metadata: { pass_kind: '24h', pass_anonymous: '1' },
        },
      },
    };
    mockAnonInsert.mockResolvedValue({
      id: 1,
      stripe_session_id: 'cs_anon_test',
      kind: '24h',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      payment_intent_id: 'pi_anon_456',
    });

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockAnonInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSessionId: 'cs_anon_test',
        kind: '24h',
        paymentIntentId: 'pi_anon_456',
        buyerEmailHash: emailHash('buyer@example.com'),
      })
    );
  });

  it('returns 200 and skips anonymous insert when payment_intent is missing', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_anon_nopi',
          amount_total: 400,
          currency: 'usd',
          customer: null,
          payment_intent: null,
          metadata: { pass_kind: '24h', pass_anonymous: '1' },
        },
      },
    };
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockAnonInsert).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('WebhookRouter — checkout_completed funnel join', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function postWebhook() {
    return fetch(`${url}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify({}),
    });
  }

  it('emits checkout_completed with anonymousId from session metadata', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_join',
          mode: 'subscription',
          metadata: { user_id: '42', anon_id: 'anon-uuid-123' },
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockTrack).toHaveBeenCalledWith(
      'checkout_completed',
      expect.objectContaining({ userId: 42, anonymousId: 'anon-uuid-123' })
    );
  });

  it('emits checkout_completed with anonymousId for an anonymous pass (no user_id)', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_anon_join',
          mode: 'payment',
          payment_intent: 'pi_anon_join',
          metadata: {
            pass_kind: '24h',
            pass_anonymous: '1',
            anon_id: 'anon-uuid-456',
          },
        },
      },
    };
    mockAnonInsert.mockResolvedValue({
      id: 1,
      stripe_session_id: 'cs_anon_join',
      kind: '24h',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      payment_intent_id: 'pi_anon_join',
    });

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockTrack).toHaveBeenCalledWith(
      'checkout_completed',
      expect.objectContaining({ userId: null, anonymousId: 'anon-uuid-456' })
    );
  });

  it('marks checkout_completed as recovered when the session was recovered', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_recovered',
          mode: 'subscription',
          recovered_from: 'cs_expired_original',
          metadata: { user_id: '42' },
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockTrack).toHaveBeenCalledWith(
      'checkout_completed',
      expect.objectContaining({
        props: expect.objectContaining({ recovered: true }),
      })
    );
  });

  it('omits the recovered prop for a non-recovered session', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_not_recovered',
          mode: 'subscription',
          recovered_from: null,
          metadata: { user_id: '42' },
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    const [, options] = mockTrack.mock.calls.find(
      (c) => c[0] === 'checkout_completed'
    ) as [string, { props: Record<string, unknown> }];
    expect(options.props).not.toHaveProperty('recovered');
  });

  it('emits checkout_completed even when no pricing_variant is set', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_no_variant',
          mode: 'subscription',
          metadata: { user_id: '7' },
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockTrack).toHaveBeenCalledWith(
      'checkout_completed',
      expect.objectContaining({ userId: 7, anonymousId: null })
    );
  });

  it('emits checkout_completed with anonymousId null when no anon_id metadata', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_no_anon',
          mode: 'subscription',
          metadata: { user_id: '9', pricing_variant: 'minimal' },
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockTrack).toHaveBeenCalledWith(
      'checkout_completed',
      expect.objectContaining({
        userId: 9,
        anonymousId: null,
        props: expect.objectContaining({ variant: 'minimal' }),
      })
    );
  });

  it('emits checkout_completed with surface when session metadata carries it', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_surface',
          mode: 'subscription',
          metadata: { user_id: '11', surface: 'pricing_page' },
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockTrack).toHaveBeenCalledWith(
      'checkout_completed',
      expect.objectContaining({
        userId: 11,
        props: expect.objectContaining({ surface: 'pricing_page' }),
      })
    );
  });

  it('omits surface from checkout_completed props when metadata lacks it', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_no_surface',
          mode: 'subscription',
          metadata: { user_id: '12' },
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    const call = mockTrack.mock.calls.find(
      (c) => c[0] === 'checkout_completed'
    );
    expect(call?.[1].props.surface).toBeUndefined();
  });
});

describe('WebhookRouter — lifetime product-ID allowlist', () => {
  const LIFETIME_PRODUCT_ID = 'prod_lifetime_abc';

  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LIFETIME_PRICE_IDS = LIFETIME_PRODUCT_ID;
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_abc',
      email: 'user@example.com',
    });
    mockUpdatePatreonByEmail.mockResolvedValue(1);
  });

  afterEach(() => {
    delete process.env.LIFETIME_PRICE_IDS;
  });

  function makeLifetimeEvent(productId: string | undefined) {
    return {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_lifetime_test',
          amount_total: 9600,
          currency: 'usd',
          customer: 'cus_abc',
          payment_intent: null,
          metadata: {},
        },
      },
    };
  }

  function postWebhookLifetime() {
    return fetch(`${url}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify({}),
    });
  }

  it('grants lifetime access when product is in LIFETIME_PRICE_IDS and amount meets threshold', async () => {
    mockSessionsRetrieve.mockResolvedValue({
      id: 'cs_lifetime_test',
      line_items: { data: [{ price: { product: LIFETIME_PRODUCT_ID } }] },
    });
    mockWebhookEvent = makeLifetimeEvent(LIFETIME_PRODUCT_ID);

    const res = await postWebhookLifetime();
    expect(res.status).toBe(200);
    expect(mockUpdatePatreonByEmail).toHaveBeenCalledWith(
      'user@example.com',
      true
    );
  });

  it('does not grant lifetime access when product is NOT in LIFETIME_PRICE_IDS', async () => {
    mockSessionsRetrieve.mockResolvedValue({
      id: 'cs_lifetime_test',
      line_items: { data: [{ price: { product: 'prod_some_other_thing' } }] },
    });
    mockWebhookEvent = makeLifetimeEvent('prod_some_other_thing');

    const res = await postWebhookLifetime();
    expect(res.status).toBe(200);
    expect(mockUpdatePatreonByEmail).not.toHaveBeenCalled();
  });

  it('does not grant lifetime access when LIFETIME_PRICE_IDS is not configured', async () => {
    delete process.env.LIFETIME_PRICE_IDS;
    mockSessionsRetrieve.mockResolvedValue({
      id: 'cs_lifetime_test',
      line_items: { data: [{ price: { product: LIFETIME_PRODUCT_ID } }] },
    });
    mockWebhookEvent = makeLifetimeEvent(LIFETIME_PRODUCT_ID);

    const res = await postWebhookLifetime();
    expect(res.status).toBe(200);
    expect(mockUpdatePatreonByEmail).not.toHaveBeenCalled();
  });

  it('supports multiple comma-separated product IDs in LIFETIME_PRICE_IDS', async () => {
    process.env.LIFETIME_PRICE_IDS = `prod_other,${LIFETIME_PRODUCT_ID},prod_another`;
    mockSessionsRetrieve.mockResolvedValue({
      id: 'cs_lifetime_test',
      line_items: { data: [{ price: { product: LIFETIME_PRODUCT_ID } }] },
    });
    mockWebhookEvent = makeLifetimeEvent(LIFETIME_PRODUCT_ID);

    const res = await postWebhookLifetime();
    expect(res.status).toBe(200);
    expect(mockUpdatePatreonByEmail).toHaveBeenCalledWith(
      'user@example.com',
      true
    );
  });
});

describe('WebhookRouter — checkout.session.expired', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => {
    jest.clearAllMocks();
    mockClaimSession.mockResolvedValue(true);
  });

  function postWebhook() {
    return fetch(`${url}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify({}),
    });
  }

  it('sends recovery email when session has customer_details.email and claim wins', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_expired_abc',
          customer_details: { email: 'buyer@example.com' },
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockClaimSession).toHaveBeenCalledWith(
      'cs_expired_abc',
      'buyer@example.com',
      expect.any(String),
      null
    );
    expect(mockSendAbandonedCheckoutRecoveryEmail).toHaveBeenCalledWith(
      'buyer@example.com',
      expect.any(String)
    );
  });

  it('passes the Stripe recovery URL and expiry through to the claim', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_expired_recovery',
          customer_details: { email: 'buyer@example.com' },
          after_expiration: {
            recovery: {
              enabled: true,
              url: 'https://buy.stripe.com/r/live_abc123',
              expires_at: 1781913600,
            },
          },
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockClaimSession).toHaveBeenCalledWith(
      'cs_expired_recovery',
      'buyer@example.com',
      expect.any(String),
      {
        url: 'https://buy.stripe.com/r/live_abc123',
        expiresAt: new Date(1781913600 * 1000),
      }
    );
  });

  it('passes a null recovery when Stripe omits the recovery URL', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_expired_no_url',
          customer_details: { email: 'buyer@example.com' },
          after_expiration: {
            recovery: { enabled: true, url: null, expires_at: null },
          },
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockClaimSession).toHaveBeenCalledWith(
      'cs_expired_no_url',
      'buyer@example.com',
      expect.any(String),
      null
    );
  });

  it('does not send email when claim is a no-op (duplicate delivery)', async () => {
    mockClaimSession.mockResolvedValue(false);
    mockWebhookEvent = {
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_expired_dup',
          customer_details: { email: 'buyer@example.com' },
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockClaimSession).toHaveBeenCalledWith(
      'cs_expired_dup',
      'buyer@example.com',
      expect.any(String),
      null
    );
    expect(mockSendAbandonedCheckoutRecoveryEmail).not.toHaveBeenCalled();
  });

  it('skips with warn log when session has no email', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockWebhookEvent = {
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_expired_noemail',
          customer_details: null,
          customer_email: null,
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockClaimSession).not.toHaveBeenCalled();
    expect(mockSendAbandonedCheckoutRecoveryEmail).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'checkout.session.expired.no_email',
      expect.objectContaining({ session_id_hash: expect.any(String) })
    );
    warnSpy.mockRestore();
  });

  it('returns 400 when Stripe signature verification fails', async () => {
    const { getStripe } = jest.requireMock('../lib/integrations/stripe') as {
      getStripe: jest.Mock;
    };
    getStripe.mockReturnValueOnce({
      webhooks: {
        constructEvent: jest.fn(() => {
          throw new Error(
            'No signatures found matching the expected signature for payload'
          );
        }),
      },
    });

    const res = await postWebhook();
    expect(res.status).toBe(400);
    expect(mockClaimSession).not.toHaveBeenCalled();
    expect(mockSendAbandonedCheckoutRecoveryEmail).not.toHaveBeenCalled();
  });

  it('uses customer_email as fallback when customer_details.email is absent', async () => {
    mockWebhookEvent = {
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_expired_fallback',
          customer_details: null,
          customer_email: 'fallback@example.com',
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockClaimSession).toHaveBeenCalledWith(
      'cs_expired_fallback',
      'fallback@example.com',
      expect.any(String),
      null
    );
    expect(mockSendAbandonedCheckoutRecoveryEmail).toHaveBeenCalledWith(
      'fallback@example.com',
      expect.any(String)
    );
  });
});

describe('WebhookRouter — stripe signature invalid error recording', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records stripe_webhook_signature_invalid when signature check fails', async () => {
    const { getStripe } = jest.requireMock('../lib/integrations/stripe') as {
      getStripe: jest.Mock;
    };
    getStripe.mockReturnValueOnce({
      webhooks: {
        constructEvent: jest.fn(() => {
          throw new Error(
            'No signatures found matching the expected signature for payload'
          );
        }),
      },
    });

    const res = await fetch(`${url}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'bad_sig',
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(mockRecordError).toHaveBeenCalledWith({
      userId: null,
      surface: 'stripe_webhook',
      code: 'stripe_webhook_signature_invalid',
      context: expect.objectContaining({ message: expect.any(String) }),
    });
  });

  it('does not include raw signature header in the context', async () => {
    const { getStripe } = jest.requireMock('../lib/integrations/stripe') as {
      getStripe: jest.Mock;
    };
    getStripe.mockReturnValueOnce({
      webhooks: {
        constructEvent: jest.fn(() => {
          throw new Error('Signature verification failed');
        }),
      },
    });

    await fetch(`${url}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'raw_secret_sig',
      },
      body: JSON.stringify({}),
    });

    const callArgs = mockRecordError.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const context = callArgs.context as Record<string, unknown>;
    expect(context).not.toHaveProperty('raw_secret_sig');
    expect(context).not.toHaveProperty('stripe-signature');
    expect(Object.keys(context)).toEqual(['message']);
  });
});

describe('WebhookRouter — customer.subscription.created', () => {
  let server: http.Server;
  let url: string;

  beforeAll(async () => {
    ({ server, url } = await buildServer());
  });

  afterAll(() => server.close());

  beforeEach(() => {
    jest.clearAllMocks();
    mockCustomersRetrieve.mockResolvedValue({
      id: 'cus_abc',
      email: 'subscriber@example.com',
    });
  });

  function postWebhook() {
    return fetch(`${url}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'sig_test',
      },
      body: JSON.stringify({}),
    });
  }

  it('calls updateStoreSubscription when a new subscription is created with active status', async () => {
    const { updateStoreSubscription } = jest.requireMock(
      '../lib/integrations/stripe'
    ) as {
      updateStoreSubscription: jest.Mock;
    };
    mockWebhookEvent = {
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_new_123',
          customer: 'cus_abc',
          status: 'active',
          items: { data: [{ price: { product: 'prod_unlimited' } }] },
          cancel_at_period_end: false,
          cancel_at: null,
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockCustomersRetrieve).toHaveBeenCalledWith('cus_abc');
    expect(updateStoreSubscription).toHaveBeenCalledWith(
      undefined,
      { id: 'cus_abc', email: 'subscriber@example.com' },
      expect.objectContaining({ id: 'sub_new_123', status: 'active' })
    );
  });

  it('records an unlinked_payment alert when no account resolves', async () => {
    const { updateStoreSubscription } = jest.requireMock(
      '../lib/integrations/stripe'
    ) as { updateStoreSubscription: jest.Mock };
    updateStoreSubscription.mockResolvedValueOnce({
      status: 'unlinked',
      resolvedUserId: null,
    });
    mockWebhookEvent = {
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_orphan_1',
          customer: 'cus_abc',
          status: 'active',
          items: { data: [{ price: { product: 'prod_unlimited' } }] },
          cancel_at_period_end: false,
          cancel_at: null,
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(mockRecordError).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'stripe_provisioning',
        code: 'unlinked_payment',
      })
    );
  });

  it('returns 200 and skips provisioning when customer ID is absent', async () => {
    const { updateStoreSubscription } = jest.requireMock(
      '../lib/integrations/stripe'
    ) as {
      updateStoreSubscription: jest.Mock;
    };
    const { getCustomerId } = jest.requireMock(
      '../lib/integrations/stripe'
    ) as {
      getCustomerId: jest.Mock;
    };
    getCustomerId.mockReturnValueOnce(undefined);
    mockWebhookEvent = {
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_no_customer',
          customer: null,
          status: 'active',
          items: { data: [] },
          cancel_at_period_end: false,
          cancel_at: null,
        },
      },
    };

    const res = await postWebhook();
    expect(res.status).toBe(200);
    expect(updateStoreSubscription).not.toHaveBeenCalled();
  });
});
