process.env.STRIPE_KEY = 'sk_test_fake_key_for_unit_tests';

import type StripeTypes from 'stripe';
import { vi } from 'vitest';

import { getStripe, latestSubscriptionState } from './stripe';

const eventCopy = (status: string) =>
  ({
    id: 'sub_late',
    status,
    customer: 'cus_1',
    cancel_at_period_end: false,
    cancel_at: null,
    items: { data: [{ price: { product: 'prod_pro' } }] },
  }) as unknown as StripeTypes.Subscription;

describe('latestSubscriptionState', () => {
  const retrieve = vi.spyOn(getStripe().subscriptions, 'retrieve');

  afterEach(() => {
    retrieve.mockReset();
  });

  it('returns what Stripe holds now, not the copy in a late event', async () => {
    const ended = { ...eventCopy('canceled') };
    retrieve.mockResolvedValue(
      ended as unknown as Awaited<ReturnType<typeof retrieve>>
    );

    const state = await latestSubscriptionState(eventCopy('active'));

    expect(retrieve).toHaveBeenCalledWith('sub_late');
    expect(state.status).toBe('canceled');
  });

  it('reads a plan Stripe no longer has as ended', async () => {
    retrieve.mockRejectedValue(
      Object.assign(new Error('No such subscription'), {
        code: 'resource_missing',
      })
    );

    const state = await latestSubscriptionState(eventCopy('active'));

    expect(state).toMatchObject({ id: 'sub_late', status: 'canceled' });
  });

  it('lets any other Stripe failure through so the webhook is retried', async () => {
    const rateLimited = Object.assign(new Error('Too many requests'), {
      code: 'rate_limit',
    });
    retrieve.mockRejectedValue(rateLimited);

    await expect(latestSubscriptionState(eventCopy('active'))).rejects.toBe(
      rateLimited
    );
  });
});
