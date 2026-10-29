import { vi } from 'vitest';
vi.mock('../../lib/misc/hashToken', () => ({
  default: (s: string) => `hashed:${s}`,
}));

import { UnlimitedCheckoutUseCase } from './UnlimitedCheckoutUseCase';
import { PricingResolutionError } from './PricingResolutionError';
import { LapsedPlan, LapsedSubscriptionError } from './LapsedSubscriptions';

const mockStripeCreateSession = vi.fn();

const makeStripe = () =>
  ({ checkout: { sessions: { create: mockStripeCreateSession } } }) as never;

const V2_PRICE_IDS: ReadonlyMap<string, string> = new Map([
  ['v2_monthly', 'price_v2_monthly'],
  ['v2_annual', 'price_v2_annual'],
]);

const makeResolver = (prices: ReadonlyMap<string, string> = V2_PRICE_IDS) => ({
  resolveByLookupKey: vi.fn(async (key: string) => prices.get(key) ?? null),
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('UnlimitedCheckoutUseCase', () => {
  it('creates a Checkout session at the v2 monthly price when interval is month', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/month',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    const result = await uc.execute({
      userEmail: 'user@example.com',
      userId: 1,
      interval: 'month',
    });

    expect(result).toEqual({
      url: 'https://checkout.stripe.com/month',
      cohort: 'v2',
    });
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_v2_monthly', quantity: 1 }],
        metadata: { user_id: '1', cohort: 'v2', interval: 'month' },
        subscription_data: { metadata: { user_id: '1' } },
      })
    );
  });

  it('creates a Checkout session at the v2 annual price when interval is year', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/year',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    const result = await uc.execute({
      userEmail: 'user@example.com',
      userId: 2,
      interval: 'year',
    });

    expect(result).toEqual({
      url: 'https://checkout.stripe.com/year',
      cohort: 'v2',
    });
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_v2_annual', quantity: 1 }],
        metadata: { user_id: '2', cohort: 'v2', interval: 'year' },
      })
    );
  });

  it('returns the success and cancel URLs', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 3,
      interval: 'month',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: expect.stringContaining(
          '/upload?checkout=success&session_id={CHECKOUT_SESSION_ID}'
        ),
        cancel_url: expect.stringContaining('/pricing'),
      })
    );
  });

  it('passes stripeCustomerId as customer when present', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 4,
      interval: 'month',
      stripeCustomerId: 'cus_existing',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_existing',
        customer_email: undefined,
        subscription_data: expect.objectContaining({
          metadata: expect.objectContaining({ user_id: '4' }),
        }),
      })
    );
  });

  it('uses customer_email when no stripeCustomerId', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'new@example.com',
      userId: 5,
      interval: 'month',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: 'new@example.com',
        customer: undefined,
      })
    );
  });

  it('emits unlimited.checkout.session_created structured log', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 6,
      interval: 'month',
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('unlimited.checkout.session_created'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  it('stamps anon_id into metadata when present', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 8,
      interval: 'month',
      anonId: 'anon-uuid-123',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          user_id: '8',
          cohort: 'v2',
          interval: 'month',
          anon_id: 'anon-uuid-123',
        },
      })
    );
  });

  it('omits anon_id from metadata when absent', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 9,
      interval: 'month',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { user_id: '9', cohort: 'v2', interval: 'month' },
      })
    );
  });

  it('stamps surface into metadata when provided', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 10,
      interval: 'month',
      surface: 'pricing_page',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          user_id: '10',
          cohort: 'v2',
          interval: 'month',
          surface: 'pricing_page',
        },
      })
    );
  });

  it('omits surface from metadata when absent', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 11,
      interval: 'month',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { user_id: '11', cohort: 'v2', interval: 'month' },
      })
    );
  });

  it('stamps ga_client_id into metadata when provided', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 12,
      interval: 'month',
      gaClientId: '1234567890.987654321',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          user_id: '12',
          cohort: 'v2',
          interval: 'month',
          ga_client_id: '1234567890.987654321',
        },
      })
    );
  });

  it('stamps ga_session_id into metadata when provided', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 12,
      interval: 'month',
      gaSessionId: '1744000000',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ ga_session_id: '1744000000' }),
      })
    );
  });

  it('omits ga_client_id from metadata when absent', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 13,
      interval: 'month',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { user_id: '13', cohort: 'v2', interval: 'month' },
      })
    );
  });

  it('enables Stripe session recovery on expiry', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 14,
      interval: 'month',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        after_expiration: { recovery: { enabled: true } },
      })
    );
  });

  it('does not log raw Stripe customer IDs', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 7,
      interval: 'month',
      stripeCustomerId: 'cus_secret_id',
    });

    const logCalls = consoleSpy.mock.calls.map((c) => JSON.stringify(c));
    for (const call of logCalls) {
      expect(call).not.toContain('cus_secret_id');
    }
    consoleSpy.mockRestore();
  });

  it('throws and creates no session when the v2 price cannot be resolved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const resolver = makeResolver(new Map());
    const uc = new UnlimitedCheckoutUseCase(makeStripe(), resolver);

    await expect(
      uc.execute({
        userEmail: 'user@example.com',
        userId: 25,
        interval: 'month',
      })
    ).rejects.toBeInstanceOf(PricingResolutionError);

    expect(resolver.resolveByLookupKey).toHaveBeenCalledWith('v2_monthly');
    expect(mockStripeCreateSession).not.toHaveBeenCalled();
  });
});

describe('UnlimitedCheckoutUseCase ad-click attribution', () => {
  it('stamps the ad click fields into session metadata', async () => {
    mockStripeCreateSession.mockResolvedValue({ url: 'https://s' });
    const uc = new UnlimitedCheckoutUseCase(makeStripe(), makeResolver());
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 12,
      interval: 'month',
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
          user_id: '12',
          gclid: 'Cj0abc',
          utm_source: 'google',
          utm_campaign: 'notion',
          landing: '/notion-to-anki/',
        }),
      })
    );
  });
});

describe('UnlimitedCheckoutUseCase with a lapsed plan on the customer', () => {
  const lapsedPlan: LapsedPlan = {
    subscriptionId: 'sub_old',
    amount: 200,
    currency: 'eur',
    interval: 'month',
    openInvoiceId: 'in_open',
    payUrl: 'https://invoice.stripe.com/i/test',
  };

  const makeGateway = (plans: LapsedPlan[]) => ({
    find: vi.fn().mockResolvedValue(plans),
    close: vi.fn().mockResolvedValue(undefined),
  });

  const makeUseCase = (gateway: ReturnType<typeof makeGateway>) =>
    new UnlimitedCheckoutUseCase(
      makeStripe(),
      makeResolver(),
      undefined,
      gateway
    );

  it('refuses with the lapsed plan and creates no session until the person chooses', async () => {
    const gateway = makeGateway([lapsedPlan]);

    await expect(
      makeUseCase(gateway).execute({
        userEmail: 'user@example.com',
        userId: 7,
        interval: 'year',
        stripeCustomerId: 'cus_lapsed',
      })
    ).rejects.toEqual(new LapsedSubscriptionError(lapsedPlan));

    expect(gateway.find).toHaveBeenCalledWith('cus_lapsed');
    expect(gateway.close).not.toHaveBeenCalled();
    expect(mockStripeCreateSession).not.toHaveBeenCalled();
  });

  it('ends the lapsed plan before creating the session when the person chose to switch', async () => {
    const gateway = makeGateway([lapsedPlan]);
    const order: string[] = [];
    gateway.close.mockImplementation(async () => {
      order.push('close');
    });
    mockStripeCreateSession.mockImplementation(async () => {
      order.push('create');
      return { url: 'https://checkout.stripe.com/year' };
    });

    const result = await makeUseCase(gateway).execute({
      userEmail: 'user@example.com',
      userId: 7,
      interval: 'year',
      stripeCustomerId: 'cus_lapsed',
      replaceLapsed: true,
    });

    expect(result.url).toBe('https://checkout.stripe.com/year');
    expect(gateway.close).toHaveBeenCalledWith([lapsedPlan]);
    expect(order).toEqual(['close', 'create']);
  });

  it('creates the session as before when the customer has no lapsed plan', async () => {
    const gateway = makeGateway([]);
    mockStripeCreateSession.mockResolvedValue({ url: 'https://s' });

    await makeUseCase(gateway).execute({
      userEmail: 'user@example.com',
      userId: 7,
      interval: 'month',
      stripeCustomerId: 'cus_clean',
      replaceLapsed: true,
    });

    expect(gateway.close).not.toHaveBeenCalled();
    expect(mockStripeCreateSession).toHaveBeenCalledTimes(1);
  });

  it('skips the lookup for someone with no Stripe customer yet', async () => {
    const gateway = makeGateway([lapsedPlan]);
    mockStripeCreateSession.mockResolvedValue({ url: 'https://s' });

    await makeUseCase(gateway).execute({
      userEmail: 'new@example.com',
      userId: 8,
      interval: 'month',
    });

    expect(gateway.find).not.toHaveBeenCalled();
    expect(mockStripeCreateSession).toHaveBeenCalledTimes(1);
  });
});
