import { describe, it, expect, vi } from 'vitest';
import { getCheckoutSessionAnonId } from './getCheckoutSessionAnonId';

function stripeWith(metadata: Record<string, string> | null) {
  const retrieve = vi.fn().mockResolvedValue({ metadata });
  return {
    retrieve,
    stripe: { checkout: { sessions: { retrieve } } } as never,
  };
}

describe('getCheckoutSessionAnonId', () => {
  it('returns the anon_id from the session metadata', async () => {
    const { stripe } = stripeWith({ anon_id: 'visitor-1', pass_kind: '24h' });
    expect(await getCheckoutSessionAnonId(stripe, 'cs_123')).toBe('visitor-1');
  });

  it('returns null when the session has no anon_id', async () => {
    const { stripe } = stripeWith({ pass_kind: '24h' });
    expect(await getCheckoutSessionAnonId(stripe, 'cs_123')).toBeNull();
  });

  it('returns null without a stripe client', async () => {
    expect(await getCheckoutSessionAnonId(undefined, 'cs_123')).toBeNull();
  });

  it('does not call stripe for a non-session id', async () => {
    const { stripe, retrieve } = stripeWith({ anon_id: 'x' });
    expect(await getCheckoutSessionAnonId(stripe, 'not-a-session')).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('returns null when the retrieve throws', async () => {
    const retrieve = vi.fn().mockRejectedValue(new Error('stripe down'));
    const stripe = { checkout: { sessions: { retrieve } } } as never;
    expect(await getCheckoutSessionAnonId(stripe, 'cs_123')).toBeNull();
  });
});
