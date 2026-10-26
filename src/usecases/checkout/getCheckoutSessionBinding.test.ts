import { describe, it, expect, vi } from 'vitest';
import { getCheckoutSessionBinding } from './getCheckoutSessionBinding';

function stripeWith(metadata: Record<string, string> | null) {
  const retrieve = vi.fn().mockResolvedValue({ metadata });
  return {
    retrieve,
    stripe: { checkout: { sessions: { retrieve } } } as never,
  };
}

describe('getCheckoutSessionBinding', () => {
  it('returns the anon_id and surface from the session metadata', async () => {
    const { stripe } = stripeWith({
      anon_id: 'visitor-1',
      surface: 'ai-preview',
      pass_kind: '24h',
    });
    expect(await getCheckoutSessionBinding(stripe, 'cs_123')).toEqual({
      anonId: 'visitor-1',
      surface: 'ai-preview',
    });
  });

  it('nulls out missing fields', async () => {
    const { stripe } = stripeWith({ pass_kind: '24h' });
    expect(await getCheckoutSessionBinding(stripe, 'cs_123')).toEqual({
      anonId: null,
      surface: null,
    });
  });

  it('returns nulls without a stripe client', async () => {
    expect(await getCheckoutSessionBinding(undefined, 'cs_123')).toEqual({
      anonId: null,
      surface: null,
    });
  });

  it('does not call stripe for a non-session id', async () => {
    const { stripe, retrieve } = stripeWith({ anon_id: 'x' });
    expect(await getCheckoutSessionBinding(stripe, 'not-a-session')).toEqual({
      anonId: null,
      surface: null,
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('returns nulls when the retrieve throws', async () => {
    const retrieve = vi.fn().mockRejectedValue(new Error('stripe down'));
    const stripe = { checkout: { sessions: { retrieve } } } as never;
    expect(await getCheckoutSessionBinding(stripe, 'cs_123')).toEqual({
      anonId: null,
      surface: null,
    });
  });
});
