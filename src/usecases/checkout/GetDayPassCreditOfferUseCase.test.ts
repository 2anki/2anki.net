import { vi } from 'vitest';
import { InMemoryDayPassCreditRepository } from '../../data_layer/DayPassCreditRepository';
import { InMemoryUserPassRepository } from '../../data_layer/UserPassRepository';
import { PricingService } from '../../services/PricingService';
import { nothingHeld, stripePassPrices } from '../../test/fakes/dayPassCredit';
import { DayPassCreditEligibility } from './dayPassCredit';
import { GetDayPassCreditOfferUseCase } from './GetDayPassCreditOfferUseCase';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-12T12:00:00.000Z');

const useCaseFor = (dayPassExpiresAt: Date | null) => {
  const credits = new InMemoryDayPassCreditRepository();
  const passes = new InMemoryUserPassRepository();
  if (dayPassExpiresAt != null) {
    credits.seedDayPass(42, 'pi_day', dayPassExpiresAt);
    passes.seed({
      user_id: 42,
      kind: '24h',
      expires_at: dayPassExpiresAt,
      stripe_payment_intent_id: 'pi_day',
    });
  }
  const sessions = { retrieve: vi.fn() };
  const useCase = new GetDayPassCreditOfferUseCase(
    new DayPassCreditEligibility({
      credits,
      passes,
      sessions: sessions as never,
      pricing: new PricingService({
        prices: stripePassPrices({
          '24h': { amount: 600 },
          '120d': { amount: 2950 },
        }),
      } as never),
      heldEntitlements: async () => nothingHeld(),
      now: () => NOW,
    })
  );
  return { useCase, credits, sessions };
};

describe('GetDayPassCreditOfferUseCase', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('reports the reduced price, both live prices and when the offer ends', async () => {
    const { useCase } = useCaseFor(new Date(NOW.getTime() + 20 * HOUR));

    expect(await useCase.execute(42)).toEqual({
      eligible: true,
      amount: 2350,
      currency: 'usd',
      display: '$23.50',
      semesterDisplay: '$29.50',
      dayPassDisplay: '$6',
      endsAt: new Date(
        NOW.getTime() + 44 * HOUR - 31 * 60 * 1000
      ).toISOString(),
      semesterStartsAt: new Date(NOW.getTime() + 20 * HOUR).toISOString(),
    });
  });

  it('says the 120 days start now when the Day Pass already ran out', async () => {
    const { useCase } = useCaseFor(new Date(NOW.getTime() - 4 * HOUR));

    expect(await useCase.execute(42)).toMatchObject({
      eligible: true,
      semesterStartsAt: null,
    });
  });

  it('reports only that there is no offer, without a reason or the Day Pass id', async () => {
    const { useCase } = useCaseFor(null);

    expect(await useCase.execute(42)).toEqual({ eligible: false });
  });

  it('stops offering the credit to a buyer who just paid the upgrade, before the webhook lands', async () => {
    const { useCase, credits, sessions } = useCaseFor(
      new Date(NOW.getTime() + 20 * HOUR)
    );
    const credit = await credits.claim(42, 'pi_day');
    await credits.attachSession(credit.id, null, 'cs_paid');
    sessions.retrieve.mockResolvedValue({ id: 'cs_paid', status: 'complete' });

    expect(await useCase.execute(42)).toEqual({ eligible: false });
  });

  it('answers not eligible when Stripe fails while reading the attached checkout', async () => {
    const { useCase, credits, sessions } = useCaseFor(
      new Date(NOW.getTime() + 20 * HOUR)
    );
    const credit = await credits.claim(42, 'pi_day');
    await credits.attachSession(credit.id, null, 'cs_open');
    sessions.retrieve.mockRejectedValue(
      Object.assign(new Error('api down'), { type: 'StripeAPIError' })
    );

    expect(await useCase.execute(42)).toEqual({ eligible: false });
  });
});
