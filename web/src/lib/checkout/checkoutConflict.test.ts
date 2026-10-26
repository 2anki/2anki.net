import { describe, expect, it } from 'vitest';
import { isPurchaseBlockCode, readCheckoutConflict } from './checkoutConflict';

describe('isPurchaseBlockCode', () => {
  it('accepts every server-defined block code', () => {
    expect(isPurchaseBlockCode('already_lifetime')).toBe(true);
    expect(isPurchaseBlockCode('already_unlimited')).toBe(true);
    expect(isPurchaseBlockCode('already_subscribed')).toBe(true);
    expect(isPurchaseBlockCode('billed_through_apple')).toBe(true);
    expect(isPurchaseBlockCode('pass_still_active')).toBe(true);
    expect(isPurchaseBlockCode('lapsed_subscription')).toBe(true);
    expect(isPurchaseBlockCode('currency_conflict')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isPurchaseBlockCode('something_else')).toBe(false);
    expect(isPurchaseBlockCode(null)).toBe(false);
    expect(isPurchaseBlockCode(42)).toBe(false);
  });
});

describe('readCheckoutConflict', () => {
  it('parses a 409 body into a typed conflict', async () => {
    const response = new Response(
      JSON.stringify({
        code: 'pass_still_active',
        message: 'Your pass is still running.',
        expiresAt: '2026-10-08T12:00:00.000Z',
      }),
      { status: 409 }
    );

    await expect(readCheckoutConflict(response)).resolves.toEqual({
      status: 'conflict',
      code: 'pass_still_active',
      expiresAt: '2026-10-08T12:00:00.000Z',
    });
  });

  it('defaults a missing expiresAt to null', async () => {
    const response = new Response(
      JSON.stringify({ code: 'already_subscribed' }),
      { status: 409 }
    );

    await expect(readCheckoutConflict(response)).resolves.toEqual({
      status: 'conflict',
      code: 'already_subscribed',
      expiresAt: null,
    });
  });

  it('carries the lapsed plan so the page can offer pay or switch', async () => {
    const response = new Response(
      JSON.stringify({
        code: 'lapsed_subscription',
        expiresAt: null,
        lapsedPlan: {
          amount: 200,
          currency: 'eur',
          interval: 'month',
          payUrl: 'https://invoice.stripe.com/i/test',
        },
      }),
      { status: 409 }
    );

    await expect(readCheckoutConflict(response)).resolves.toEqual({
      status: 'conflict',
      code: 'lapsed_subscription',
      expiresAt: null,
      lapsedPlan: {
        amount: 200,
        currency: 'eur',
        interval: 'month',
        payUrl: 'https://invoice.stripe.com/i/test',
      },
    });
  });

  it('drops a malformed lapsed plan but keeps the code', async () => {
    const response = new Response(
      JSON.stringify({ code: 'lapsed_subscription', lapsedPlan: 'nope' }),
      { status: 409 }
    );

    await expect(readCheckoutConflict(response)).resolves.toEqual({
      status: 'conflict',
      code: 'lapsed_subscription',
      expiresAt: null,
    });
  });

  it('returns null for an unrecognised code', async () => {
    const response = new Response(JSON.stringify({ code: 'mystery' }), {
      status: 409,
    });

    await expect(readCheckoutConflict(response)).resolves.toBeNull();
  });

  it('returns null for an unparseable body', async () => {
    const response = new Response('not json', { status: 409 });

    await expect(readCheckoutConflict(response)).resolves.toBeNull();
  });
});
