import { CreatePassCheckoutUseCase } from './CreatePassCheckoutUseCase';

const mockStripeCreateSession = jest.fn();

const makeStripe = () =>
  ({ checkout: { sessions: { create: mockStripeCreateSession } } }) as never;

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.APP_URL;
});

describe('CreatePassCheckoutUseCase', () => {
  it('creates a payment-mode session for 24h pass and returns url', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/24h',
    });

    const uc = new CreatePassCheckoutUseCase(makeStripe(), 'price_24h', '24h');
    const result = await uc.execute({
      userEmail: 'user@example.com',
      userId: 7,
    });

    expect(result).toEqual({ url: 'https://checkout.stripe.com/24h' });
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        line_items: [{ price: 'price_24h', quantity: 1 }],
        metadata: { user_id: '7', pass_kind: '24h' },
        success_url: expect.stringContaining('/upload?from=pass'),
        cancel_url: expect.stringContaining('/pricing'),
      })
    );
  });

  it('creates a payment-mode session for 7d pass and returns url', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/7d',
    });

    const uc = new CreatePassCheckoutUseCase(makeStripe(), 'price_7d', '7d');
    const result = await uc.execute({
      userEmail: 'user@example.com',
      userId: 8,
    });

    expect(result).toEqual({ url: 'https://checkout.stripe.com/7d' });
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { user_id: '8', pass_kind: '7d' },
      })
    );
  });

  it('uses customer_email when no stripe customer ID provided', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new CreatePassCheckoutUseCase(makeStripe(), 'price_24h', '24h');
    await uc.execute({ userEmail: 'user@example.com', userId: 1 });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: 'user@example.com',
        customer: undefined,
      })
    );
  });

  it('uses customer ID when provided and omits customer_email', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new CreatePassCheckoutUseCase(makeStripe(), 'price_24h', '24h');
    await uc.execute({
      userEmail: 'user@example.com',
      userId: 1,
      stripeCustomerId: 'cus_123',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_123',
        customer_email: undefined,
      })
    );
  });

  it('enables Stripe session recovery on expiry', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/24h',
    });

    const uc = new CreatePassCheckoutUseCase(makeStripe(), 'price_24h', '24h');
    await uc.execute({ userEmail: 'user@example.com', userId: 7 });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        after_expiration: { recovery: { enabled: true } },
      })
    );
  });

  it('enables Stripe invoice creation for Fiken bookkeeping', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/24h',
    });

    const uc = new CreatePassCheckoutUseCase(makeStripe(), 'price_24h', '24h');
    await uc.execute({ userEmail: 'user@example.com', userId: 7 });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice_creation: { enabled: true },
      })
    );
  });

  it('uses APP_URL env var for success and cancel URLs', async () => {
    process.env.APP_URL = 'https://staging.2anki.net';
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new CreatePassCheckoutUseCase(makeStripe(), 'price_24h', '24h');
    await uc.execute({ userEmail: 'user@example.com', userId: 1 });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: 'https://staging.2anki.net/upload?from=pass',
        cancel_url: 'https://staging.2anki.net/pricing',
      })
    );
  });

  describe('pricing A/B variant attribution', () => {
    it('stamps the pricing variant into session metadata when provided', async () => {
      mockStripeCreateSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/v',
      });

      const uc = new CreatePassCheckoutUseCase(
        makeStripe(),
        'price_24h',
        '24h'
      );
      await uc.execute({
        userEmail: 'user@example.com',
        userId: 7,
        variant: 'minimal',
      });

      expect(mockStripeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            user_id: '7',
            pass_kind: '24h',
            pricing_variant: 'minimal',
          },
        })
      );
    });

    it('omits pricing_variant when no variant is supplied', async () => {
      mockStripeCreateSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/v',
      });

      const uc = new CreatePassCheckoutUseCase(
        makeStripe(),
        'price_24h',
        '24h'
      );
      await uc.execute({ userEmail: 'user@example.com', userId: 7 });

      const call = mockStripeCreateSession.mock.calls[0][0];
      expect(call.metadata.pricing_variant).toBeUndefined();
    });
  });

  describe('anon_id funnel attribution', () => {
    it('stamps anon_id into metadata when provided for a logged-in pass', async () => {
      mockStripeCreateSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/a',
      });

      const uc = new CreatePassCheckoutUseCase(
        makeStripe(),
        'price_24h',
        '24h'
      );
      await uc.execute({
        userEmail: 'user@example.com',
        userId: 7,
        anonId: 'anon-uuid-123',
      });

      expect(mockStripeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            user_id: '7',
            pass_kind: '24h',
            anon_id: 'anon-uuid-123',
          },
        })
      );
    });

    it('stamps anon_id into metadata for an anonymous pass', async () => {
      mockStripeCreateSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/anon',
      });

      const uc = new CreatePassCheckoutUseCase(
        makeStripe(),
        'price_24h',
        '24h'
      );
      await uc.execute({ anonId: 'anon-uuid-456' });

      expect(mockStripeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            pass_kind: '24h',
            pass_anonymous: '1',
            anon_id: 'anon-uuid-456',
          },
        })
      );
    });

    it('omits anon_id when no cookie value is supplied', async () => {
      mockStripeCreateSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/a',
      });

      const uc = new CreatePassCheckoutUseCase(
        makeStripe(),
        'price_24h',
        '24h'
      );
      await uc.execute({ userEmail: 'user@example.com', userId: 7 });

      const call = mockStripeCreateSession.mock.calls[0][0];
      expect(call.metadata.anon_id).toBeUndefined();
    });
  });

  describe('surface attribution', () => {
    it('stamps surface into metadata when provided', async () => {
      mockStripeCreateSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/s',
      });

      const uc = new CreatePassCheckoutUseCase(
        makeStripe(),
        'price_24h',
        '24h'
      );
      await uc.execute({
        userEmail: 'user@example.com',
        userId: 7,
        surface: 'limit-wall',
      });

      expect(mockStripeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { user_id: '7', pass_kind: '24h', surface: 'limit-wall' },
        })
      );
    });

    it('omits surface when none is supplied', async () => {
      mockStripeCreateSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/s',
      });

      const uc = new CreatePassCheckoutUseCase(
        makeStripe(),
        'price_24h',
        '24h'
      );
      await uc.execute({ userEmail: 'user@example.com', userId: 7 });

      const call = mockStripeCreateSession.mock.calls[0][0];
      expect(call.metadata.surface).toBeUndefined();
    });
  });

  describe('anonymous mode (no userId / no userEmail)', () => {
    it('omits user_id from metadata and sets pass_anonymous=1', async () => {
      mockStripeCreateSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/anon',
      });

      const uc = new CreatePassCheckoutUseCase(
        makeStripe(),
        'price_24h',
        '24h'
      );
      await uc.execute({});

      expect(mockStripeCreateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { pass_kind: '24h', pass_anonymous: '1' },
        })
      );
    });

    it('omits customer_email in anonymous mode so Stripe collects it', async () => {
      mockStripeCreateSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/anon',
      });

      const uc = new CreatePassCheckoutUseCase(
        makeStripe(),
        'price_24h',
        '24h'
      );
      await uc.execute({});

      const call = mockStripeCreateSession.mock.calls[0][0];
      expect(call.customer_email).toBeUndefined();
      expect(call.customer).toBeUndefined();
    });

    it('embeds {CHECKOUT_SESSION_ID} template in success_url for anonymous mode', async () => {
      mockStripeCreateSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/anon',
      });

      const uc = new CreatePassCheckoutUseCase(
        makeStripe(),
        'price_24h',
        '24h'
      );
      await uc.execute({});

      const call = mockStripeCreateSession.mock.calls[0][0];
      expect(call.success_url).toContain('{CHECKOUT_SESSION_ID}');
      expect(call.success_url).toContain('/upload?pass_session=');
    });

    it('collects an optional account_email custom field so a signed-out buyer can link the pass', async () => {
      mockStripeCreateSession.mockResolvedValue({
        url: 'https://checkout.stripe.com/anon',
      });

      const uc = new CreatePassCheckoutUseCase(
        makeStripe(),
        'price_24h',
        '24h'
      );
      await uc.execute({});

      const call = mockStripeCreateSession.mock.calls[0][0];
      expect(call.custom_fields).toEqual([
        {
          key: 'account_email',
          label: {
            type: 'custom',
            custom: 'Your 2anki account email (optional)',
          },
          type: 'text',
          optional: true,
        },
      ]);
    });
  });

  it('omits the account_email custom field for signed-in sessions', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/test',
    });

    const uc = new CreatePassCheckoutUseCase(makeStripe(), 'price_24h', '24h');
    await uc.execute({ userEmail: 'user@example.com', userId: 42 });

    const call = mockStripeCreateSession.mock.calls[0][0];
    expect(call.custom_fields).toBeUndefined();
  });
});
