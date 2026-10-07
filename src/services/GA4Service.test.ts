import { vi, type MockedFunction } from 'vitest';
const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

describe('sendPurchaseEvent', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GA4_API_SECRET: 'test-secret',
      GA4_MEASUREMENT_ID: 'G-TEST123',
    };
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
    } as Response);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('sends a purchase event with the correct payload shape', async () => {
    const { sendPurchaseEvent } = await import('./GA4Service');
    await sendPurchaseEvent({
      transactionId: 'cs_test_abc123',
      valueCents: 999,
      currency: 'usd',
      stripeCustomerId: 'cus_test123',
      clientId: 'GA1.1.123456789.1234567890',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as MockedFunction<typeof fetch>).mock
      .calls[0];

    expect(String(url)).toBe(
      `${GA4_ENDPOINT}?measurement_id=G-TEST123&api_secret=test-secret`
    );

    const body = JSON.parse((options as RequestInit).body as string);
    expect(body).toMatchObject({
      client_id: 'GA1.1.123456789.1234567890',
      events: [
        {
          name: 'purchase',
          params: {
            transaction_id: 'cs_test_abc123',
            value: 9.99,
            currency: 'USD',
            items: [],
          },
        },
      ],
    });
  });

  it('does not call fetch when GA4_API_SECRET is absent', async () => {
    delete process.env.GA4_API_SECRET;
    const { sendPurchaseEvent } = await import('./GA4Service');

    await sendPurchaseEvent({
      transactionId: 'cs_test_abc123',
      valueCents: 999,
      currency: 'usd',
      stripeCustomerId: 'cus_test123',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not call fetch when GA4_MEASUREMENT_ID is absent', async () => {
    delete process.env.GA4_MEASUREMENT_ID;
    const { sendPurchaseEvent } = await import('./GA4Service');

    await sendPurchaseEvent({
      transactionId: 'cs_test_abc123',
      valueCents: 999,
      currency: 'usd',
      stripeCustomerId: 'cus_test123',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to stripeCustomerId as client_id when clientId param is absent', async () => {
    const { sendPurchaseEvent } = await import('./GA4Service');
    await sendPurchaseEvent({
      transactionId: 'cs_test_abc123',
      valueCents: 500,
      currency: 'eur',
      stripeCustomerId: 'cus_fallback123',
    });

    const [, options] = (global.fetch as MockedFunction<typeof fetch>).mock
      .calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.client_id).toBe('cus_fallback123');
  });
});
