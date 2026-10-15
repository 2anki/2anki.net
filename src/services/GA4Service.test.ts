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
      clientId: 'GA1.1.123456789.1234567890',
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as MockedFunction<typeof fetch>).mock
      .calls[0];

    expect(String(url)).toBe(
      `${GA4_ENDPOINT}?measurement_id=G-TEST123&api_secret=test-secret`
    );

    expect((options as RequestInit).signal).toBeInstanceOf(AbortSignal);
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
      clientId: 'GA1.1.123456789.1234567890',
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
      clientId: 'GA1.1.123456789.1234567890',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('adds session_id and engagement_time_msec when a sessionId is provided', async () => {
    const { sendPurchaseEvent } = await import('./GA4Service');
    await sendPurchaseEvent({
      transactionId: 'cs_test_abc123',
      valueCents: 999,
      currency: 'usd',
      clientId: 'GA1.1.123456789.1234567890',
      sessionId: '1744000000',
    });

    const [, options] = (global.fetch as MockedFunction<typeof fetch>).mock
      .calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.events[0].params).toMatchObject({
      session_id: '1744000000',
      engagement_time_msec: 1,
    });
  });

  it('omits session_id and engagement_time_msec when no sessionId is provided', async () => {
    const { sendPurchaseEvent } = await import('./GA4Service');
    await sendPurchaseEvent({
      transactionId: 'cs_test_abc123',
      valueCents: 999,
      currency: 'usd',
      clientId: 'GA1.1.123456789.1234567890',
    });

    const [, options] = (global.fetch as MockedFunction<typeof fetch>).mock
      .calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.events[0].params).not.toHaveProperty('session_id');
    expect(body.events[0].params).not.toHaveProperty('engagement_time_msec');
  });
});

describe('sendSignUpEvent', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GA4_API_SECRET: 'test-secret',
      GA4_MEASUREMENT_ID: 'G-TEST123',
    };
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('sends a sign_up event with method and client id', async () => {
    const { sendSignUpEvent } = await import('./GA4Service');
    await sendSignUpEvent({
      clientId: 'GA1.1.123456789.1234567890',
      method: 'google',
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
      events: [{ name: 'sign_up', params: { method: 'google' } }],
    });
    expect(body.events[0].params).not.toHaveProperty('session_id');
  });

  it('adds session_id and engagement_time_msec when a sessionId is provided', async () => {
    const { sendSignUpEvent } = await import('./GA4Service');
    await sendSignUpEvent({
      clientId: 'GA1.1.123456789.1234567890',
      method: 'password',
      sessionId: '1744000000',
    });

    const [, options] = (global.fetch as MockedFunction<typeof fetch>).mock
      .calls[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.events[0].params).toMatchObject({
      method: 'password',
      session_id: '1744000000',
      engagement_time_msec: 1,
    });
  });

  it('does not call fetch when GA4 env vars are absent', async () => {
    delete process.env.GA4_API_SECRET;
    const { sendSignUpEvent } = await import('./GA4Service');

    await sendSignUpEvent({
      clientId: 'GA1.1.123456789.1234567890',
      method: 'google',
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
