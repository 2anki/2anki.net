import { vi } from 'vitest';
import { InMemoryDayPassCreditRepository } from '../../data_layer/DayPassCreditRepository';
import { PricingService } from '../../services/PricingService';
import type { HeldEntitlements } from './resolvePurchaseBlock';
import {
  nothingHeld,
  stripePassPrices,
  type LivePasses,
} from '../../test/fakes/dayPassCredit';
import { DayPassCreditEligibility } from './dayPassCredit';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-12T12:00:00.000Z');

const setup = (
  options: {
    held?: HeldEntitlements;
    prices?: LivePasses;
    dayPassBoughtHoursAgo?: number | null;
  } = {}
) => {
  const credits = new InMemoryDayPassCreditRepository();
  const hoursAgo =
    options.dayPassBoughtHoursAgo === undefined
      ? 2
      : options.dayPassBoughtHoursAgo;
  if (hoursAgo != null) {
    credits.seedDayPass(
      42,
      'pi_day',
      new Date(NOW.getTime() - hoursAgo * HOUR + 24 * HOUR)
    );
  }
  const stripe = {
    prices: stripePassPrices(
      options.prices ?? { '24h': { amount: 600 }, '120d': { amount: 2900 } }
    ),
  };
  const eligibility = new DayPassCreditEligibility({
    credits,
    pricing: new PricingService(stripe as never),
    heldEntitlements: async () =>
      options.held ??
      nothingHeld({
        activePassKind: '24h',
        activePassExpiresAt: new Date(NOW.getTime() + 22 * HOUR),
      }),
    now: () => NOW,
  });
  return { credits, eligibility, stripe };
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
      amount: 2300,
      currency: 'usd',
      semesterAmount: 2900,
      dayPassAmount: 600,
      semesterProductId: 'prod_120d',
    });
  });

  it('still offers the credit after the Day Pass ran out, inside 48 hours of buying it', async () => {
    const { eligibility } = setup({
      held: nothingHeld(),
      dayPassBoughtHoursAgo: 40,
    });

    expect(await eligibility.decide(42)).toMatchObject({
      eligible: true,
      endsAt: new Date(NOW.getTime() + 8 * HOUR),
    });
  });

  it.each([
    ['bought 48 hours ago', 48],
    ['bought 60 hours ago', 60],
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

  it.each<[string, Partial<HeldEntitlements>]>([
    [
      'an active Semester Pass',
      { activePassKind: '120d', activePassExpiresAt: new Date('2027-01-01') },
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

  it('keeps offering the credit while an upgrade checkout is open but unpaid', async () => {
    const { eligibility, credits } = setup();
    const credit = await credits.claim(42, 'pi_day');
    await credits.attachSession(credit.id, null, 'cs_open');

    expect(await eligibility.decide(42)).toMatchObject({ eligible: true });
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

  it('does not ask Stripe for prices when there is no recent Day Pass', async () => {
    const { eligibility, stripe } = setup({
      held: nothingHeld(),
      dayPassBoughtHoursAgo: null,
    });

    await eligibility.decide(42);

    expect(stripe.prices.search).not.toHaveBeenCalled();
  });
});
