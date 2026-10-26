import { vi } from 'vitest';
import { StripeLapsedSubscriptions } from './LapsedSubscriptions';

const subscription = (
  id: string,
  status: string,
  latestInvoice: unknown = null
) => ({
  id,
  status,
  currency: 'eur',
  items: {
    data: [{ price: { unit_amount: 200, recurring: { interval: 'month' } } }],
  },
  latest_invoice: latestInvoice,
});

const makeStripe = (data: unknown[]) => ({
  subscriptions: {
    list: vi.fn().mockResolvedValue({ data }),
    cancel: vi.fn().mockResolvedValue({}),
  },
  invoices: { voidInvoice: vi.fn().mockResolvedValue({}) },
});

describe('StripeLapsedSubscriptions.find', () => {
  it('returns past_due, unpaid and incomplete plans with their open invoice', async () => {
    const stripe = makeStripe([
      subscription('sub_past_due', 'past_due', {
        id: 'in_open',
        status: 'open',
        hosted_invoice_url: 'https://invoice.stripe.com/i/test',
      }),
      subscription('sub_unpaid', 'unpaid'),
      subscription('sub_incomplete', 'incomplete'),
      subscription('sub_active', 'active'),
      subscription('sub_trialing', 'trialing'),
      subscription('sub_canceled', 'canceled'),
    ]);

    const plans = await new StripeLapsedSubscriptions(stripe as never).find(
      'cus_1'
    );

    expect(stripe.subscriptions.list).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_1',
        status: 'all',
        expand: ['data.latest_invoice'],
      })
    );
    expect(plans.map((plan) => plan.subscriptionId)).toEqual([
      'sub_past_due',
      'sub_unpaid',
      'sub_incomplete',
    ]);
    expect(plans[0]).toEqual({
      subscriptionId: 'sub_past_due',
      amount: 200,
      currency: 'eur',
      interval: 'month',
      openInvoiceId: 'in_open',
      payUrl: 'https://invoice.stripe.com/i/test',
    });
  });

  it('gives no pay link when the latest invoice is not open', async () => {
    const stripe = makeStripe([
      subscription('sub_1', 'past_due', {
        id: 'in_paid',
        status: 'paid',
        hosted_invoice_url: 'https://invoice.stripe.com/i/paid',
      }),
    ]);

    const [plan] = await new StripeLapsedSubscriptions(stripe as never).find(
      'cus_1'
    );

    expect(plan.openInvoiceId).toBeNull();
    expect(plan.payUrl).toBeNull();
  });

  it('returns nothing for a customer Stripe no longer has', async () => {
    const stripe = makeStripe([]);
    stripe.subscriptions.list.mockRejectedValue({
      code: 'resource_missing',
      param: 'customer',
    });

    await expect(
      new StripeLapsedSubscriptions(stripe as never).find('cus_gone')
    ).resolves.toEqual([]);
  });

  it('rethrows any other Stripe error', async () => {
    const stripe = makeStripe([]);
    stripe.subscriptions.list.mockRejectedValue(new Error('stripe down'));

    await expect(
      new StripeLapsedSubscriptions(stripe as never).find('cus_1')
    ).rejects.toThrow('stripe down');
  });
});

describe('StripeLapsedSubscriptions.close', () => {
  const plan = {
    subscriptionId: 'sub_old',
    amount: 200,
    currency: 'eur',
    interval: 'month' as const,
    openInvoiceId: 'in_open',
    payUrl: 'https://invoice.stripe.com/i/test',
  };

  it('cancels the subscription, then voids its open invoice', async () => {
    const stripe = makeStripe([]);
    const order: string[] = [];
    stripe.subscriptions.cancel.mockImplementation(async () => {
      order.push('cancel');
    });
    stripe.invoices.voidInvoice.mockImplementation(async () => {
      order.push('void');
    });

    await new StripeLapsedSubscriptions(stripe as never).close([plan]);

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_old');
    expect(stripe.invoices.voidInvoice).toHaveBeenCalledWith('in_open');
    expect(order).toEqual(['cancel', 'void']);
  });

  it('skips the void when there is no open invoice', async () => {
    const stripe = makeStripe([]);

    await new StripeLapsedSubscriptions(stripe as never).close([
      { ...plan, openInvoiceId: null, payUrl: null },
    ]);

    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_old');
    expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled();
  });

  it('still lets checkout continue when the void fails', async () => {
    const stripe = makeStripe([]);
    stripe.invoices.voidInvoice.mockRejectedValue({ code: 'invoice_not_open' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      new StripeLapsedSubscriptions(stripe as never).close([plan])
    ).resolves.toBeUndefined();
  });

  it('stops when the cancel fails, so no session starts on top of an open plan', async () => {
    const stripe = makeStripe([]);
    stripe.subscriptions.cancel.mockRejectedValue(new Error('stripe down'));

    await expect(
      new StripeLapsedSubscriptions(stripe as never).close([plan])
    ).rejects.toThrow('stripe down');
    expect(stripe.invoices.voidInvoice).not.toHaveBeenCalled();
  });
});
