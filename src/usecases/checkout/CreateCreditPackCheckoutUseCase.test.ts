import { CreateCreditPackCheckoutUseCase } from './CreateCreditPackCheckoutUseCase';

const mockStripeCreateSession = jest.fn();

const makeStripe = () =>
  ({ checkout: { sessions: { create: mockStripeCreateSession } } }) as never;

beforeEach(() => {
  jest.resetAllMocks();
  delete process.env.APP_URL;
});

describe('CreateCreditPackCheckoutUseCase', () => {
  it('creates a payment-mode session tagged as a credit pack and returns the url', async () => {
    mockStripeCreateSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/pack',
    });

    const uc = new CreateCreditPackCheckoutUseCase(makeStripe(), 'price_pack');
    const result = await uc.execute({
      userId: 7,
      userEmail: 'user@example.com',
      source: 'credits_account',
    });

    expect(result).toEqual({ url: 'https://checkout.stripe.com/pack' });
    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        invoice_creation: { enabled: true },
        line_items: [{ price: 'price_pack', quantity: 1 }],
        metadata: expect.objectContaining({
          credit_pack: '1',
          user_id: '7',
          surface: 'credits_account',
        }),
      })
    );
  });

  it('sends the account buyer back to /account with the credits flag', async () => {
    process.env.APP_URL = 'https://staging.2anki.net';
    mockStripeCreateSession.mockResolvedValue({ url: 'https://s' });

    const uc = new CreateCreditPackCheckoutUseCase(makeStripe(), 'price_pack');
    await uc.execute({ userId: 1, source: 'credits_account' });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: 'https://staging.2anki.net/account?credits=added',
        cancel_url: 'https://staging.2anki.net/account',
      })
    );
  });

  it('sends the upload-surface buyers back to /upload', async () => {
    process.env.APP_URL = 'https://staging.2anki.net';
    mockStripeCreateSession.mockResolvedValue({ url: 'https://s' });

    const uc = new CreateCreditPackCheckoutUseCase(makeStripe(), 'price_pack');
    await uc.execute({ userId: 1, source: 'credits_conversion' });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: 'https://staging.2anki.net/upload?credits=added',
        cancel_url: 'https://staging.2anki.net/upload',
      })
    );
  });

  it('falls back to a safe /upload redirect when the source is missing', async () => {
    process.env.APP_URL = 'https://staging.2anki.net';
    mockStripeCreateSession.mockResolvedValue({ url: 'https://s' });

    const uc = new CreateCreditPackCheckoutUseCase(makeStripe(), 'price_pack');
    await uc.execute({ userId: 1 });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: 'https://staging.2anki.net/upload?credits=added',
        cancel_url: 'https://staging.2anki.net/upload',
      })
    );
  });

  it('uses customer_email when no stripe customer id is provided', async () => {
    mockStripeCreateSession.mockResolvedValue({ url: 'https://s' });

    const uc = new CreateCreditPackCheckoutUseCase(makeStripe(), 'price_pack');
    await uc.execute({ userId: 1, userEmail: 'user@example.com' });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_email: 'user@example.com',
        customer: undefined,
      })
    );
  });

  it('uses the customer id when provided and omits customer_email', async () => {
    mockStripeCreateSession.mockResolvedValue({ url: 'https://s' });

    const uc = new CreateCreditPackCheckoutUseCase(makeStripe(), 'price_pack');
    await uc.execute({
      userId: 1,
      userEmail: 'user@example.com',
      stripeCustomerId: 'cus_123',
    });

    expect(mockStripeCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_123',
        customer_email: undefined,
      })
    );
  });

  it('stamps the ga client id for purchase attribution when provided', async () => {
    mockStripeCreateSession.mockResolvedValue({ url: 'https://s' });

    const uc = new CreateCreditPackCheckoutUseCase(makeStripe(), 'price_pack');
    await uc.execute({ userId: 1, gaClientId: 'GA1.2.3' });

    const call = mockStripeCreateSession.mock.calls[0][0];
    expect(call.metadata.ga_client_id).toBe('GA1.2.3');
  });
});
