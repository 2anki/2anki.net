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

const makeUseCase = () =>
  new AutoSyncCheckoutUseCase(
    {
      checkout: { sessions: { create: mockStripeCreateSession } },
      subscriptions: { retrieve: mockRetrieveSubscription },
      billingPortal: { sessions: { create: mockCreatePortalSession } },
    } as never,
    AUTO_SYNC_PRICE_ID,
    AUTO_SYNC_PRODUCT_ID,
    MAX_SUBSCRIBERS
  );

beforeEach(() => {
  vi.resetAllMocks();
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
        success_url: expect.stringContaining('/ankify/setup'),
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
                return_url: expect.stringContaining('/ankify/setup'),
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
      });

      expect(mockRetrieveSubscription).toHaveBeenCalledWith('sub_pro');
      expect(mockCreatePortalSession).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_pro' })
      );
    });

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
