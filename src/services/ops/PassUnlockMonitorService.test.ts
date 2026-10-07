import { vi } from 'vitest';
import type { Stripe } from 'stripe';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

import {
  PassUnlockMonitorService,
  UserPassLookupSource,
  AnonymousPassLookupSource,
} from './PassUnlockMonitorService';

const NOW = new Date('2026-07-14T12:00:00.000Z');
const SINCE = new Date('2026-07-07T12:00:00.000Z');

type SessionOverrides = Partial<StripeTypes.Checkout.Session>;

const secondsFor = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const buildSession = (
  overrides: SessionOverrides
): StripeTypes.Checkout.Session =>
  ({
    id: 'cs_test_1',
    object: 'checkout.session',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: 'pi_1',
    amount_total: 199,
    currency: 'usd',
    created: secondsFor('2026-07-10T12:00:00.000Z'),
    metadata: { pass_kind: '24h' },
    ...overrides,
  }) as StripeTypes.Checkout.Session;

const buildStripe = (
  sessions: StripeTypes.Checkout.Session[]
): (() => Stripe) => {
  const list = vi.fn().mockResolvedValue({
    object: 'list',
    data: sessions,
    has_more: false,
  });
  return () =>
    ({
      checkout: { sessions: { list } },
    }) as unknown as Stripe;
};

const buildUserPasses = (
  grantedPaymentIntentIds: string[]
): UserPassLookupSource => ({
  existsByPaymentIntentId: async (id: string) =>
    grantedPaymentIntentIds.includes(id),
});

const buildAnonymousPasses = (
  grantedSessionIds: string[]
): AnonymousPassLookupSource => ({
  findBySessionId: async (id: string) =>
    grantedSessionIds.includes(id) ? { id: 1 } : null,
});

describe('PassUnlockMonitorService', () => {
  it('flags a completed user pass payment with no matching pass row', async () => {
    const session = buildSession({
      id: 'cs_missing',
      payment_intent: 'pi_missing',
      metadata: { pass_kind: '7d' },
    });
    const service = new PassUnlockMonitorService({
      stripeFactory: buildStripe([session]),
      userPasses: buildUserPasses([]),
      anonymousPasses: buildAnonymousPasses([]),
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.error).toBeUndefined();
    expect(result.checked).toBe(1);
    expect(result.granted).toBe(0);
    expect(result.missing).toBe(1);
    expect(result.missingPayments).toEqual([
      {
        sessionId: 'cs_missing',
        paymentIntentId: 'pi_missing',
        kind: '7d',
        anonymous: false,
        createdAt: '2026-07-10T12:00:00.000Z',
        amountTotal: 199,
        currency: 'usd',
      },
    ]);
  });

  it('counts a completed pass payment with a matching user pass row as granted', async () => {
    const session = buildSession({ payment_intent: 'pi_ok' });
    const service = new PassUnlockMonitorService({
      stripeFactory: buildStripe([session]),
      userPasses: buildUserPasses(['pi_ok']),
      anonymousPasses: buildAnonymousPasses([]),
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.checked).toBe(1);
    expect(result.granted).toBe(1);
    expect(result.missing).toBe(0);
    expect(result.missingPayments).toEqual([]);
  });

  it('resolves anonymous passes by session id, not payment intent', async () => {
    const session = buildSession({
      id: 'cs_anon',
      payment_intent: 'pi_anon',
      metadata: { pass_kind: '24h', pass_anonymous: '1' },
    });
    const service = new PassUnlockMonitorService({
      stripeFactory: buildStripe([session]),
      userPasses: buildUserPasses([]),
      anonymousPasses: buildAnonymousPasses(['cs_anon']),
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.granted).toBe(1);
    expect(result.missing).toBe(0);
  });

  it('flags an anonymous pass payment whose anonymous_passes row is missing', async () => {
    const session = buildSession({
      id: 'cs_anon_missing',
      payment_intent: 'pi_anon_missing',
      metadata: { pass_kind: '24h', pass_anonymous: '1' },
    });
    const service = new PassUnlockMonitorService({
      stripeFactory: buildStripe([session]),
      userPasses: buildUserPasses(['pi_anon_missing']),
      anonymousPasses: buildAnonymousPasses([]),
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.missing).toBe(1);
    expect(result.missingPayments[0]).toMatchObject({
      sessionId: 'cs_anon_missing',
      anonymous: true,
    });
  });

  it('treats a session inside the grace window as pending, not missing', async () => {
    const session = buildSession({
      id: 'cs_recent',
      payment_intent: 'pi_recent',
      created: secondsFor('2026-07-14T11:55:00.000Z'),
    });
    const service = new PassUnlockMonitorService({
      stripeFactory: buildStripe([session]),
      userPasses: buildUserPasses([]),
      anonymousPasses: buildAnonymousPasses([]),
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.pending).toBe(1);
    expect(result.checked).toBe(0);
    expect(result.missing).toBe(0);
    expect(result.missingPayments).toEqual([]);
  });

  it('ignores non-pass, unpaid, and incomplete checkout sessions', async () => {
    const sessions = [
      buildSession({ id: 'cs_sub', metadata: { source: 'checkout' } }),
      buildSession({ id: 'cs_unpaid', payment_status: 'unpaid' }),
      buildSession({ id: 'cs_open', status: 'open' }),
    ];
    const service = new PassUnlockMonitorService({
      stripeFactory: buildStripe(sessions),
      userPasses: buildUserPasses([]),
      anonymousPasses: buildAnonymousPasses([]),
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.checked).toBe(0);
    expect(result.pending).toBe(0);
    expect(result.missing).toBe(0);
  });

  it('lists Stripe sessions created at or after the window start', async () => {
    const list = vi.fn().mockResolvedValue({
      object: 'list',
      data: [],
      has_more: false,
    });
    const stripeFactory = () =>
      ({ checkout: { sessions: { list } } }) as unknown as Stripe;
    const service = new PassUnlockMonitorService({
      stripeFactory,
      userPasses: buildUserPasses([]),
      anonymousPasses: buildAnonymousPasses([]),
    });

    await service.getStatus(SINCE, NOW);

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        created: { gte: secondsFor('2026-07-07T12:00:00.000Z') },
        limit: 100,
      })
    );
  });

  it('paginates until has_more is false', async () => {
    const first = buildSession({ id: 'cs_a', payment_intent: 'pi_a' });
    const second = buildSession({ id: 'cs_b', payment_intent: 'pi_b' });
    const list = vi
      .fn()
      .mockResolvedValueOnce({ object: 'list', data: [first], has_more: true })
      .mockResolvedValueOnce({
        object: 'list',
        data: [second],
        has_more: false,
      });
    const stripeFactory = () =>
      ({ checkout: { sessions: { list } } }) as unknown as Stripe;
    const service = new PassUnlockMonitorService({
      stripeFactory,
      userPasses: buildUserPasses([]),
      anonymousPasses: buildAnonymousPasses([]),
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ starting_after: 'cs_a' })
    );
    expect(result.checked).toBe(2);
    expect(result.missing).toBe(2);
  });

  it('returns an error string instead of throwing when Stripe fails', async () => {
    const list = vi.fn().mockRejectedValue(new Error('stripe down'));
    const stripeFactory = () =>
      ({ checkout: { sessions: { list } } }) as unknown as Stripe;
    const service = new PassUnlockMonitorService({
      stripeFactory,
      userPasses: buildUserPasses([]),
      anonymousPasses: buildAnonymousPasses([]),
    });

    const result = await service.getStatus(SINCE, NOW);

    expect(result.error).toBe('stripe down');
    expect(result.missingPayments).toEqual([]);
    expect(result.checked).toBe(0);
  });
});
