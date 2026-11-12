import { vi } from 'vitest';
import { InMemoryDayPassCreditRepository } from '../../data_layer/DayPassCreditRepository';
import { InMemoryUserPassRepository } from '../../data_layer/UserPassRepository';
import { PricingService } from '../../services/PricingService';
import type { HeldEntitlements } from './resolvePurchaseBlock';
import {
  nothingHeld,
  stripePassPrices,
  type LivePasses,
} from '../../test/fakes/dayPassCredit';
import {
  CheckoutSessionReadError,
  DayPassCreditEligibility,
} from './dayPassCredit';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const NOW = new Date('2026-11-12T12:00:00.000Z');

const setup = (
  options: {
    held?: HeldEntitlements;
    prices?: LivePasses;
    dayPassBoughtHoursAgo?: number | null;
  } = {}
) => {
  const credits = new InMemoryDayPassCreditRepository();
  const passes = new InMemoryUserPassRepository();
  const hoursAgo =
    options.dayPassBoughtHoursAgo === undefined
      ? 2
      : options.dayPassBoughtHoursAgo;
  if (hoursAgo != null) {
    const expiresAt = new Date(NOW.getTime() - hoursAgo * HOUR + 24 * HOUR);
    credits.seedDayPass(42, 'pi_day', expiresAt);
    passes.seed({
      user_id: 42,
      kind: '24h',
      expires_at: expiresAt,
      stripe_payment_intent_id: 'pi_day',
    });
  }
  const sessions = { retrieve: vi.fn() };
  const stripe = {
    prices: stripePassPrices(
      options.prices ?? { '24h': { amount: 600 }, '120d': { amount: 2900 } }
    ),
  };
  const heldEntitlements = vi.fn(
    async () =>
      options.held ??
      nothingHeld({
        activePassKind: '24h',
        activePassExpiresAt: new Date(NOW.getTime() + 22 * HOUR),
      })
  );
  const eligibility = new DayPassCreditEligibility({
    credits,
    passes,
    sessions,
    pricing: new PricingService(stripe as never),
    heldEntitlements,
    now: () => NOW,
  });
  return { credits, passes, sessions, eligibility, stripe, heldEntitlements };
};

describe('DayPassCreditEligibility', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('offers the Semester Pass at its live price minus the live Day Pass price to a Day Pass holder', async () => {
    const { eligibility } = setup();

    expect(await eligibility.decide(42)).toEqual({
      eligible: true,
      dayPassPaymentIntentId: 'pi_day',
      endsAt: new Date(NOW.getTime() + 46 * HOUR),
      offerEndsAt: new Date(NOW.getTime() + 46 * HOUR - 31 * MINUTE),
      checkoutExpiresAt: new Date(NOW.getTime() + 23 * HOUR + 55 * MINUTE),
      semesterStartsAt: new Date(NOW.getTime() + 22 * HOUR),
      amount: 2300,
      currency: 'usd',
      semesterAmount: 2900,
      dayPassAmount: 600,
      semesterProductId: 'prod_120d',
      credit: null,
      openSessionUrl: null,
    });
  });

  it('still offers the credit after the Day Pass ran out, inside 48 hours of buying it, with checkout closing when the offer ends', async () => {
    const { eligibility } = setup({
      held: nothingHeld(),
      dayPassBoughtHoursAgo: 40,
    });

    expect(await eligibility.decide(42)).toMatchObject({
      eligible: true,
      endsAt: new Date(NOW.getTime() + 8 * HOUR),
      offerEndsAt: new Date(NOW.getTime() + 8 * HOUR - 31 * MINUTE),
      checkoutExpiresAt: new Date(NOW.getTime() + 8 * HOUR),
      semesterStartsAt: null,
    });
  });

  it.each([
    ['bought 48 hours ago', 48],
    ['bought 60 hours ago', 60],
    ['whose offer has under 31 minutes left', 48 - 30 / 60],
    ['stacked behind another pass, ending more than a day from now', -100],
    ['no Day Pass at all', null],
  ])('refuses a Day Pass %s', async (_label, hoursAgo) => {
    const { eligibility } = setup({
      held: nothingHeld(),
      dayPassBoughtHoursAgo: hoursAgo,
    });

    expect(await eligibility.decide(42)).toEqual({
      eligible: false,
      reason: 'no_recent_day_pass',
    });
  });

  it('offers the credit with 31 minutes left', async () => {
    const { eligibility } = setup({
      held: nothingHeld(),
      dayPassBoughtHoursAgo: 48 - 31 / 60,
    });

    expect(await eligibility.decide(42)).toMatchObject({
      eligible: true,
      checkoutExpiresAt: new Date(NOW.getTime() + 31 * MINUTE),
    });
  });

  it('dates the start of the 120 days from the latest running pass, which the grant stacks behind', async () => {
    const { eligibility, passes } = setup();
    passes.seed({
      user_id: 42,
      kind: '24h',
      expires_at: new Date(NOW.getTime() + 30 * HOUR),
      stripe_payment_intent_id: 'apple:claimed-day',
    });

    expect(await eligibility.decide(42)).toMatchObject({
      eligible: true,
      dayPassPaymentIntentId: 'pi_day',
      semesterStartsAt: new Date(NOW.getTime() + 30 * HOUR),
    });
  });

  it('offers the credit to a Day Pass holder whose subscription lapsed and is no longer active', async () => {
    const { eligibility } = setup({
      held: nothingHeld({
        activeSubscription: false,
        activePassKind: '24h',
        activePassExpiresAt: new Date(NOW.getTime() + 22 * HOUR),
      }),
    });

    expect(await eligibility.decide(42)).toMatchObject({ eligible: true });
  });

  it('refuses a credit row that belongs to someone else without reading its checkout', async () => {
    const { eligibility, credits, sessions } = setup();
    const credit = await credits.claim(7, 'pi_day');
    await credits.attachSession(credit.id, null, 'cs_theirs');

    expect(await eligibility.decide(42)).toEqual({
      eligible: false,
      reason: 'credit_used',
    });
    expect(sessions.retrieve).not.toHaveBeenCalled();
  });

  it('reports a Stripe failure reading the attached checkout as a session read error', async () => {
    const { eligibility, credits, sessions } = setup();
    const credit = await credits.claim(42, 'pi_day');
    await credits.attachSession(credit.id, null, 'cs_open');
    sessions.retrieve.mockRejectedValue(
      Object.assign(new Error('api down'), { type: 'StripeAPIError' })
    );

    await expect(eligibility.decide(42)).rejects.toBeInstanceOf(
      CheckoutSessionReadError
    );
  });

  it('reads nothing else for an account with no recent Day Pass', async () => {
    const { eligibility, heldEntitlements, stripe } = setup({
      dayPassBoughtHoursAgo: null,
    });

    await eligibility.decide(42);

    expect(heldEntitlements).not.toHaveBeenCalled();
    expect(stripe.prices.search).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<HeldEntitlements>]>([
    [
      'an active Semester Pass',
      { activePassKind: '120d', activePassExpiresAt: new Date('2027-01-01') },
    ],
    [
      'a Semester Pass inside its renewal window',
      {
        activePassKind: '120d',
        activePassExpiresAt: new Date('2026-11-16'),
        semesterRenewalOpen: true,
      },
    ],
    [
      'an active Week Pass',
      { activePassKind: '7d', activePassExpiresAt: new Date('2026-11-15') },
    ],
    ['an active subscription', { activeSubscription: true }],
    ['lifetime access', { lifetime: true }],
    [
      'a plan billed to the email but not proven',
      { unprovenSubscription: true },
    ],
    [
      'unlimited access',
      {
        activePassKind: 'unlimited',
        activePassExpiresAt: new Date('2027-01-01'),
      },
    ],
  ])('refuses someone holding %s', async (_label, held) => {
    const { eligibility } = setup({ held: nothingHeld(held) });

    expect(await eligibility.decide(42)).toEqual({
      eligible: false,
      reason: 'plan_held',
    });
  });

  it('refuses a Day Pass holder who also holds another running pass that expires sooner', async () => {
    const { eligibility, passes } = setup();
    passes.seed({
      user_id: 42,
      kind: '7d',
      expires_at: new Date(NOW.getTime() + 10 * HOUR),
      stripe_payment_intent_id: 'pi_week',
    });

    expect(await eligibility.decide(42)).toEqual({
      eligible: false,
      reason: 'plan_held',
    });
  });

  it('refuses a Day Pass whose credit was already redeemed', async () => {
    const { eligibility, credits } = setup();
    const credit = await credits.claim(42, 'pi_day');
    await credits.attachSession(credit.id, null, 'cs_paid');
    await credits.markRedeemedBySession('cs_paid', NOW);

    expect(await eligibility.decide(42)).toEqual({
      eligible: false,
      reason: 'credit_used',
    });
  });

  it('treats a credit as used once Stripe reports its checkout paid, before the webhook lands', async () => {
    const { eligibility, credits, sessions } = setup();
    const credit = await credits.claim(42, 'pi_day');
    await credits.attachSession(credit.id, null, 'cs_paid');
    sessions.retrieve.mockResolvedValue({ id: 'cs_paid', status: 'complete' });

    expect(await eligibility.decide(42)).toEqual({
      eligible: false,
      reason: 'credit_used',
    });
    expect(sessions.retrieve).toHaveBeenCalledWith('cs_paid');
  });

  it('keeps offering the credit while an upgrade checkout is open but unpaid, and returns that checkout', async () => {
    const { eligibility, credits, sessions } = setup();
    const credit = await credits.claim(42, 'pi_day');
    await credits.attachSession(credit.id, null, 'cs_open');
    sessions.retrieve.mockResolvedValue({
      id: 'cs_open',
      status: 'open',
      url: 'https://checkout.stripe.com/c/cs_open',
    });

    expect(await eligibility.decide(42)).toMatchObject({
      eligible: true,
      openSessionUrl: 'https://checkout.stripe.com/c/cs_open',
    });
  });

  it.each([
    ['expired', async () => ({ id: 'cs_old', status: 'expired' })],
    [
      'gone from Stripe',
      async () => {
        throw Object.assign(new Error('No such checkout.session'), {
          type: 'StripeInvalidRequestError',
          code: 'resource_missing',
        });
      },
    ],
  ])(
    'offers the credit again when the earlier checkout is %s',
    async (_label, retrieve) => {
      const { eligibility, credits, sessions } = setup();
      const credit = await credits.claim(42, 'pi_day');
      await credits.attachSession(credit.id, null, 'cs_old');
      sessions.retrieve.mockImplementation(retrieve);

      expect(await eligibility.decide(42)).toMatchObject({
        eligible: true,
        openSessionUrl: null,
      });
    }
  );

  it('does not read Stripe sessions for a credit with no checkout yet', async () => {
    const { eligibility, credits, sessions } = setup();
    await credits.claim(42, 'pi_day');

    await eligibility.decide(42);

    expect(sessions.retrieve).not.toHaveBeenCalled();
  });

  it.each<[string, LivePasses]>([
    [
      'the two prices are in different currencies',
      { '24h': { amount: 600, currency: 'eur' }, '120d': { amount: 2900 } },
    ],
    [
      'the reduced price would fall under the card minimum',
      { '24h': { amount: 600 }, '120d': { amount: 620 } },
    ],
  ])('refuses when %s', async (_label, prices) => {
    const { eligibility } = setup({ prices });

    expect(await eligibility.decide(42)).toEqual({
      eligible: false,
      reason: 'price_unavailable',
    });
  });

  it('refuses when Stripe cannot report the live prices', async () => {
    const { eligibility, stripe } = setup();
    stripe.prices.search.mockRejectedValue(new Error('stripe down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await eligibility.decide(42)).toEqual({
      eligible: false,
      reason: 'price_unavailable',
    });
  });
});
