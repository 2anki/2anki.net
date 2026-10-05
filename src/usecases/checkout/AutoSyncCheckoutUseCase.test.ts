jest.mock('../../lib/integrations/stripe', () => ({
  getStripe: jest.fn(),
  getCustomerId: jest.fn(),
  updateStoreSubscription: jest.fn(),
}));

jest.mock('../../services/SubscriptionService');

jest.mock('../../lib/misc/hashToken', () => (s: string) => `hashed:${s}`);

import { AutoSyncCheckoutUseCase } from './AutoSyncCheckoutUseCase';
import SubscriptionService from '../../services/SubscriptionService';

const mockCountActive = SubscriptionService.countActiveByProductId as jest.Mock;
const mockGetUserActiveSubscriptions =
  SubscriptionService.getUserActiveSubscriptions as jest.Mock;

const AUTO_SYNC_PRODUCT_ID = 'prod_test_auto_sync';
const AUTO_SYNC_PRICE_ID = 'price_test_auto_sync';
const MAX_SUBSCRIBERS = 10;

const mockStripeCreateSession = jest.fn();

const makeUseCase = () =>
  new AutoSyncCheckoutUseCase(
    { checkout: { sessions: { create: mockStripeCreateSession } } } as never,
    AUTO_SYNC_PRICE_ID,
    AUTO_SYNC_PRODUCT_ID,
    MAX_SUBSCRIBERS
  );

beforeEach(() => {
  jest.resetAllMocks();
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

  test('omits anon_id from metadata when absent', async () => {
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

    const consoleSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

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

    const consoleSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

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

    const consoleSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const uc = makeUseCase();
    await uc.execute({ userEmail: 'user@example.com', userId: 42 });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('auto_sync.checkout.session_created'),
      expect.anything()
    );

    consoleSpy.mockRestore();
  });
});
