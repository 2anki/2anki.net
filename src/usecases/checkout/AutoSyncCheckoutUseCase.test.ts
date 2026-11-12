import {
  LapsedSubscriptionError,
  type LapsedSubscriptionGateway,
} from './LapsedSubscriptions';
import { vi, type Mock } from 'vitest';
vi.mock('../../lib/integrations/stripe', () => ({
  getStripe: vi.fn(),
  getCustomerId: vi.fn(),
  updateStoreSubscription: vi.fn(),
}));

vi.mock('../../services/SubscriptionService');

vi.mock('../../lib/misc/hashToken', () => ({
  default: (s: string) => `hashed:${s}`,
}));

import { AutoSyncCheckoutUseCase } from './AutoSyncCheckoutUseCase';
import SubscriptionService from '../../services/SubscriptionService';

const mockCountActive = SubscriptionService.countActiveByProductId as Mock;
const mockGetUserActiveSubscriptions =
  SubscriptionService.getUserActiveSubscriptions as Mock;

const AUTO_SYNC_PRODUCT_ID = 'prod_test_auto_sync';
const AUTO_SYNC_PRICE_ID = 'price_test_auto_sync';
const MAX_SUBSCRIBERS = 10;

const mockStripeCreateSession = vi.fn();
const mockRetrieveSubscription = vi.fn();
const mockCreatePortalSession = vi.fn();

const lapsedPlan = {
  subscriptionId: 'sub_old',
  amount: 200,
  currency: 'eur',
  interval: 'month' as const,
  openInvoiceId: 'in_old',
  payUrl: 'https://invoice.stripe.com/i/old',
};

const makeUseCase = (lapsed?: LapsedSubscriptionGateway) =>
  new AutoSyncCheckoutUseCase(
    {
      checkout: { sessions: { create: mockStripeCreateSession } },
      subscriptions: { retrieve: mockRetrieveSubscription },
      billingPortal: { sessions: { create: mockCreatePortalSession } },
    } as never,
    AUTO_SYNC_PRICE_ID,
    AUTO_SYNC_PRODUCT_ID,
    MAX_SUBSCRIBERS,
    undefined,
    lapsed
  );

beforeEach(() => {
  vi.resetAllMocks();
});

describe('AutoSyncCheckoutUseCase with an unpaid plan', () => {
  const buy = (lapsed: LapsedSubscriptionGateway, replaceLapsed = false) => {
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockStripeCreateSession.mockResolvedValue({
      id: 'cs_1',
      url: 'https://checkout.stripe.com/new',
    });
    return makeUseCase(lapsed).execute({
      userEmail: 'user@example.com',
      userId: 42,
      stripeCustomerId: 'cus_1',
      replaceLapsed,
    });
  };

  test('stops for the person to choose and starts no checkout', async () => {
    const close = vi.fn();

    await expect(
      buy({ find: async () => [lapsedPlan], close })
    ).rejects.toBeInstanceOf(LapsedSubscriptionError);

    expect(close).not.toHaveBeenCalled();
    expect(mockStripeCreateSession).not.toHaveBeenCalled();
  });

  test('ends the old plan only when asked, then starts checkout', async () => {
    const close = vi.fn().mockResolvedValue(undefined);

    const result = await buy({ find: async () => [lapsedPlan], close }, true);

    expect(close).toHaveBeenCalledWith([lapsedPlan]);
    expect(result).toEqual({ url: 'https://checkout.stripe.com/new' });
  });

  test('carries on with no unpaid plan', async () => {
    const result = await buy({ find: async () => [], close: vi.fn() });

    expect(result).toEqual({ url: 'https://checkout.stripe.com/new' });
  });

  test('starts no checkout when ending the old plan fails', async () => {
    const close = vi.fn().mockRejectedValue(new Error('stripe down'));

    await expect(
      buy({ find: async () => [lapsedPlan], close }, true)
    ).rejects.toThrow();

    expect(mockStripeCreateSession).not.toHaveBeenCalled();
  });

  test('asks nothing of a buyer with no Stripe customer yet', async () => {
    const find = vi.fn();
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockStripeCreateSession.mockResolvedValue({
      id: 'cs_1',
      url: 'https://checkout.stripe.com/new',
    });

    const result = await makeUseCase({ find, close: vi.fn() }).execute({
      userEmail: 'user@example.com',
      userId: 42,
      stripeCustomerId: null,
    });

    expect(find).not.toHaveBeenCalled();
    expect(result).toEqual({ url: 'https://checkout.stripe.com/new' });
  });

  test('leaves the old plan alone when the cap is reached', async () => {
    const find = vi.fn();
    const close = vi.fn();
    mockCountActive.mockResolvedValue(MAX_SUBSCRIBERS);

    const result = await makeUseCase({ find, close }).execute({
      userEmail: 'user@example.com',
      userId: 42,
      stripeCustomerId: 'cus_1',
      replaceLapsed: true,
    });

    expect(result).toEqual({ status: 'cap_reached' });
    expect(find).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  test('sends a Pro subscriber to the portal before any unpaid plan is read', async () => {
    const find = vi.fn();
    const close = vi.fn();
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([
      {
        active: true,
        stripe_product_id: 'prod_pro',
        payload: { id: 'sub_pro' },
      },
    ]);
    mockRetrieveSubscription.mockResolvedValue({
      id: 'sub_pro',
      customer: 'cus_1',
      items: { data: [{ id: 'si_1' }] },
    });
    mockCreatePortalSession.mockResolvedValue({
      id: 'bps_1',
      url: 'https://billing.stripe.com/session',
    });

    const result = await makeUseCase({ find, close }).execute({
      userEmail: 'user@example.com',
      userId: 42,
      stripeCustomerId: 'cus_1',
      replaceLapsed: true,
    });

    expect(result).toEqual({ url: 'https://billing.stripe.com/session' });
    expect(find).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

describe('AutoSyncCheckoutUseCase', () => {
  test('returns cap_reached when active subscriber count meets the cap', async () => {
    mockCountActive.mockResolvedValue(MAX_SUBSCRIBERS);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);

    const uc = makeUseCase();
    const result = await uc.execute({
      userEmail: 'user@example.com',
      userId: 42,
    });

    expect(result).toEqual({ status: 'cap_reached' });
    expect(mockStripeCreateSession).not.toHaveBeenCalled();
  });

  test('returns already_subscribed when user already has an active Auto Sync sub', async () => {
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([
      { active: true, stripe_product_id: AUTO_SYNC_PRODUCT_ID },
    ]);

    const uc = makeUseCase();
    const result = await uc.execute({
      userEmail: 'user@example.com',
      userId: 42,
    });

    expect(result).toEqual({ status: 'already_subscribed' });
    expect(mockStripeCreateSession).not.toHaveBeenCalled();
  });

  test('creates a Stripe Checkout Session and returns url when within cap', async () => {
    mockCountActive.mockResolvedValue(5);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = makeUseCase();
    const result = await uc.execute({
      userEmail: 'user@example.com',
      userId: 42,
    });

    expect(result).toEqual({ url: 'https://checkout.stripe.com/test' });
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: AUTO_SYNC_PRICE_ID, quantity: 1 }],
        success_url: expect.stringContaining(
          '/ankify/setup?checkout=success&session_id={CHECKOUT_SESSION_ID}'
        ),
        cancel_url: expect.stringContaining('/pricing'),
        metadata: { user_id: '42' },
        subscription_data: { metadata: { user_id: '42' } },
      })
    );
  });

  test('enables Stripe session recovery on expiry', async () => {
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = makeUseCase();
    await uc.execute({ userEmail: 'user@example.com', userId: 42 });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        after_expiration: { recovery: { enabled: true } },
      })
    );
  });

  test('stamps anon_id into metadata when present', async () => {
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = makeUseCase();
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 42,
      anonId: 'anon-uuid-123',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { user_id: '42', anon_id: 'anon-uuid-123' },
      })
    );
  });

  test('stamps the consent marker beside anon_id when tracking is allowed', async () => {
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = makeUseCase();
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 42,
      anonId: 'anon-uuid-123',
      anonIdTrackingAllowed: true,
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          user_id: '42',
          anon_id: 'anon-uuid-123',
          anon_id_consent: 'granted',
        },
      })
    );
  });

  test('omits optional attribution keys (anon_id, surface) from metadata when absent', async () => {
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = makeUseCase();
    await uc.execute({ userEmail: 'user@example.com', userId: 42 });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { user_id: '42' },
      })
    );
  });

  test('stamps surface into metadata when provided', async () => {
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = makeUseCase();
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 42,
      surface: 'pricing_page',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { user_id: '42', surface: 'pricing_page' },
      })
    );
  });

  test('stamps ga_client_id and ga_session_id into metadata when provided', async () => {
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = makeUseCase();
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 42,
      gaClientId: '1234567890.987654321',
      gaSessionId: '1744000000',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          user_id: '42',
          ga_client_id: '1234567890.987654321',
          ga_session_id: '1744000000',
        },
      })
    );
  });

  test('does not log raw Stripe IDs in session creation args', async () => {
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const uc = makeUseCase();
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 42,
      stripeCustomerId: 'cus_secret',
    });

    const logCalls = consoleSpy.mock.calls.map((c) => JSON.stringify(c));
    for (const call of logCalls) {
      expect(call).not.toContain('cus_secret');
    }

    consoleSpy.mockRestore();
  });

  test('emits auto_sync.checkout.cap_reached structured log', async () => {
    mockCountActive.mockResolvedValue(MAX_SUBSCRIBERS);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);

    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const uc = makeUseCase();
    await uc.execute({ userEmail: 'user@example.com', userId: 42 });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('auto_sync.checkout.cap_reached'),
      expect.anything()
    );

    consoleSpy.mockRestore();
  });

  test('emits auto_sync.checkout.session_created structured log', async () => {
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const uc = makeUseCase();
    await uc.execute({ userEmail: 'user@example.com', userId: 42 });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('auto_sync.checkout.session_created'),
      expect.anything()
    );

    consoleSpy.mockRestore();
  });

  describe('when the user already pays for Pro', () => {
    const proRow = {
      active: true,
      stripe_product_id: 'prod_pro',
      payload: { id: 'sub_pro', object: 'subscription' },
    };

    beforeEach(() => {
      mockCountActive.mockResolvedValue(0);
      mockGetUserActiveSubscriptions.mockResolvedValue([proRow]);
    });

    test('sends them to Stripe to switch the Pro subscription to Auto Sync', async () => {
      mockRetrieveSubscription.mockResolvedValue({
        id: 'sub_pro',
        customer: 'cus_pro',
        status: 'active',
        items: { data: [{ id: 'si_pro' }] },
      });
      mockCreatePortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/session/test',
      });

      const result = await makeUseCase().execute({
        userEmail: 'user@example.com',
        userId: 42,
        stripeCustomerId: 'cus_pro',
      });

      expect(result).toEqual({
        url: 'https://billing.stripe.com/session/test',
      });
      expect(mockRetrieveSubscription).toHaveBeenCalledWith('sub_pro');
      expect(mockCreatePortalSession).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: 'cus_pro',
          return_url: expect.stringContaining('/pricing'),
          flow_data: {
            type: 'subscription_update_confirm',
            subscription_update_confirm: {
              subscription: 'sub_pro',
              items: [{ id: 'si_pro', price: AUTO_SYNC_PRICE_ID, quantity: 1 }],
            },
            after_completion: {
              type: 'redirect',
              redirect: {
                return_url: expect.stringContaining(
                  '/ankify/setup?checkout=success'
                ),
              },
            },
          },
        })
      );
      expect(mockStripeCreateSession).not.toHaveBeenCalled();
    });

    test('reads the subscription id from a payload stored as a JSON string', async () => {
      mockGetUserActiveSubscriptions.mockResolvedValue([
        { ...proRow, payload: JSON.stringify(proRow.payload) },
      ]);
      mockRetrieveSubscription.mockResolvedValue({
        id: 'sub_pro',
        customer: { id: 'cus_pro' },
        status: 'active',
        items: { data: [{ id: 'si_pro' }] },
      });
      mockCreatePortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/session/test',
      });

      await makeUseCase().execute({
        userEmail: 'user@example.com',
        userId: 42,
        stripeCustomerId: 'cus_pro',
      });

      expect(mockRetrieveSubscription).toHaveBeenCalledWith('sub_pro');
      expect(mockCreatePortalSession).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_pro' })
      );
    });

    test.each([
      ['another customer', 'cus_someone_else'],
      ['no customer on the account', null],
    ])(
      'never opens a billing portal for a subscription owned by %s',
      async (_label, accountCustomer) => {
        mockRetrieveSubscription.mockResolvedValue({
          id: 'sub_pro',
          customer: 'cus_pro',
          status: 'active',
          items: { data: [{ id: 'si_pro' }] },
        });

        const result = await makeUseCase().execute({
          userEmail: 'user@example.com',
          userId: 42,
          stripeCustomerId: accountCustomer,
        });

        expect(result).toEqual({ status: 'upgrade_unavailable' });
        expect(mockCreatePortalSession).not.toHaveBeenCalled();
        expect(mockStripeCreateSession).not.toHaveBeenCalled();
      }
    );

    test('never opens a second checkout, so the two plans cannot share one row', async () => {
      mockRetrieveSubscription.mockResolvedValue({
        id: 'sub_pro',
        customer: 'cus_pro',
        status: 'active',
        items: { data: [{ id: 'si_a' }, { id: 'si_b' }] },
      });

      const result = await makeUseCase().execute({
        userEmail: 'user@example.com',
        userId: 42,
      });

      expect(result).toEqual({ status: 'upgrade_unavailable' });
      expect(mockStripeCreateSession).not.toHaveBeenCalled();
      expect(mockCreatePortalSession).not.toHaveBeenCalled();
    });

    test('reports upgrade_unavailable when the stored row has no Stripe subscription id', async () => {
      mockGetUserActiveSubscriptions.mockResolvedValue([
        { ...proRow, payload: {} },
      ]);

      const result = await makeUseCase().execute({
        userEmail: 'user@example.com',
        userId: 42,
      });

      expect(result).toEqual({ status: 'upgrade_unavailable' });
      expect(mockRetrieveSubscription).not.toHaveBeenCalled();
      expect(mockStripeCreateSession).not.toHaveBeenCalled();
    });
  });
});

describe('AutoSyncCheckoutUseCase ad-click attribution', () => {
  test('stamps the ad click fields into session metadata', async () => {
    mockCountActive.mockResolvedValue(0);
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    mockStripeCreateSession.mockResolvedValue({ url: 'https://s' });
    const uc = makeUseCase();
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 42,
      adClick: {
        gclid: 'Cj0abc',
        utm_source: 'google',
        utm_campaign: 'notion',
        landing: '/notion-to-anki/',
      },
    });
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          user_id: '42',
          gclid: 'Cj0abc',
          utm_source: 'google',
          utm_campaign: 'notion',
          landing: '/notion-to-anki/',
        }),
      })
    );
  });
});
