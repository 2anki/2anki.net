import { vi } from 'vitest';
vi.mock('../../lib/misc/hashToken', () => ({
  default: (s: string) => `hashed:${s}`,
}));

import { UnlimitedCheckoutUseCase } from './UnlimitedCheckoutUseCase';
import { PricingResolutionError } from './PricingResolutionError';

const mockStripeCreateSession = vi.fn();

const makeStripe = () =>
  ({ checkout: { sessions: { create: mockStripeCreateSession } } }) as never;

const MONTHLY_PRICE_ID = 'price_unlimited_monthly';
const YEARLY_PRICE_ID = 'price_unlimited_yearly';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('UnlimitedCheckoutUseCase', () => {
  it('creates a Checkout session with the monthly price ID when interval is month', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/month',
    });

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
    const result = await uc.execute({
      userEmail: 'user@example.com',
      userId: 1,
      interval: 'month',
    });

    expect(result).toEqual({
      url: 'https://checkout.stripe.com/month',
      cohort: 'legacy',
    });
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: MONTHLY_PRICE_ID, quantity: 1 }],
        metadata: { user_id: '1', cohort: 'legacy', interval: 'month' },
        subscription_data: { metadata: { user_id: '1' } },
      })
    );
  });

  it('creates a Checkout session with the yearly price ID when interval is year', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/year',
    });

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
    const result = await uc.execute({
      userEmail: 'user@example.com',
      userId: 2,
      interval: 'year',
    });

    expect(result).toEqual({
      url: 'https://checkout.stripe.com/year',
      cohort: 'legacy',
    });
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: YEARLY_PRICE_ID, quantity: 1 }],
        metadata: { user_id: '2', cohort: 'legacy', interval: 'year' },
      })
    );
  });

  it('returns the success and cancel URLs', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 3,
      interval: 'month',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: expect.stringContaining('/upload'),
        cancel_url: expect.stringContaining('/pricing'),
      })
    );
  });

  it('passes stripeCustomerId as customer when present', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
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

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
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

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
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

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
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
          cohort: 'legacy',
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

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 9,
      interval: 'month',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { user_id: '9', cohort: 'legacy', interval: 'month' },
      })
    );
  });

  it('stamps surface into metadata when provided', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
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
          cohort: 'legacy',
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

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 11,
      interval: 'month',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { user_id: '11', cohort: 'legacy', interval: 'month' },
      })
    );
  });

  it('stamps ga_client_id into metadata when provided', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
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
          cohort: 'legacy',
          interval: 'month',
          ga_client_id: '1234567890.987654321',
        },
      })
    );
  });

  it('omits ga_client_id from metadata when absent', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 13,
      interval: 'month',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { user_id: '13', cohort: 'legacy', interval: 'month' },
      })
    );
  });

  it('enables Stripe session recovery on expiry', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
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

    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID
    );
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

  const beforeCutover = new Date('2026-06-09T00:00:00Z');
  const afterCutover = new Date('2026-06-16T00:00:00Z');
  const insideWindow = new Date('2026-06-18T00:00:00Z');
  const afterWindow = new Date('2026-06-22T00:00:00Z');

  const makeResolver = (id: string | null) => ({
    resolveByLookupKey: vi.fn().mockResolvedValue(id),
  });

  it('uses the legacy env price for a pre-cutover user inside the lock-in window when flag on', async () => {
    mockStripeCreateSession.mockResolvedValue({ url: 'https://x' });
    const resolver = makeResolver('price_v2_monthly');
    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID,
      resolver as never
    );

    await uc.execute({
      userEmail: 'user@example.com',
      userId: 20,
      interval: 'month',
      pricingV2On: true,
      createdAt: beforeCutover,
      now: insideWindow,
    });

    expect(resolver.resolveByLookupKey).not.toHaveBeenCalled();
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: MONTHLY_PRICE_ID, quantity: 1 }],
        metadata: { user_id: '20', cohort: 'legacy', interval: 'month' },
      })
    );
  });

  it('resolves the v2 price for a pre-cutover user after the window when flag on', async () => {
    mockStripeCreateSession.mockResolvedValue({ url: 'https://x' });
    const resolver = makeResolver('price_v2_annual');
    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID,
      resolver as never
    );

    await uc.execute({
      userEmail: 'user@example.com',
      userId: 21,
      interval: 'year',
      pricingV2On: true,
      createdAt: beforeCutover,
      now: afterWindow,
    });

    expect(resolver.resolveByLookupKey).toHaveBeenCalledWith('v2_annual');
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_v2_annual', quantity: 1 }],
        metadata: { user_id: '21', cohort: 'v2', interval: 'year' },
      })
    );
  });

  it('resolves the v2 price for a post-cutover user when flag on', async () => {
    mockStripeCreateSession.mockResolvedValue({ url: 'https://x' });
    const resolver = makeResolver('price_v2_monthly');
    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID,
      resolver as never
    );

    await uc.execute({
      userEmail: 'user@example.com',
      userId: 22,
      interval: 'month',
      pricingV2On: true,
      createdAt: afterCutover,
      now: insideWindow,
    });

    expect(resolver.resolveByLookupKey).toHaveBeenCalledWith('v2_monthly');
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_v2_monthly', quantity: 1 }],
        metadata: { user_id: '22', cohort: 'v2', interval: 'month' },
      })
    );
  });

  it('falls back to the legacy env price when v2 resolution fails', async () => {
    mockStripeCreateSession.mockResolvedValue({ url: 'https://x' });
    const resolver = makeResolver(null);
    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID,
      resolver as never
    );

    await uc.execute({
      userEmail: 'user@example.com',
      userId: 23,
      interval: 'month',
      pricingV2On: true,
      createdAt: afterCutover,
      now: insideWindow,
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: MONTHLY_PRICE_ID, quantity: 1 }],
        metadata: { user_id: '23', cohort: 'v2', interval: 'month' },
      })
    );
  });

  it('throws and creates no session when v2 resolution fails after the window', async () => {
    const resolver = makeResolver(null);
    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID,
      resolver as never
    );

    await expect(
      uc.execute({
        userEmail: 'user@example.com',
        userId: 25,
        interval: 'month',
        pricingV2On: true,
        createdAt: afterCutover,
        now: afterWindow,
      })
    ).rejects.toBeInstanceOf(PricingResolutionError);

    expect(mockStripeCreateSession).not.toHaveBeenCalled();
  });

  it('uses legacy env prices for everyone when the flag is off', async () => {
    mockStripeCreateSession.mockResolvedValue({ url: 'https://x' });
    const resolver = makeResolver('price_v2_monthly');
    const uc = new UnlimitedCheckoutUseCase(
      makeStripe(),
      MONTHLY_PRICE_ID,
      YEARLY_PRICE_ID,
      resolver as never
    );

    await uc.execute({
      userEmail: 'user@example.com',
      userId: 24,
      interval: 'month',
      pricingV2On: false,
      createdAt: afterCutover,
      now: insideWindow,
    });

    expect(resolver.resolveByLookupKey).not.toHaveBeenCalled();
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: MONTHLY_PRICE_ID, quantity: 1 }],
        metadata: { user_id: '24', cohort: 'legacy', interval: 'month' },
      })
    );
  });
});
