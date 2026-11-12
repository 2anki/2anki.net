import { vi } from 'vitest';
import { InMemoryDayPassCreditRepository } from '../../data_layer/DayPassCreditRepository';
import { PricingService } from '../../services/PricingService';
import { nothingHeld, stripePassPrices } from '../../test/fakes/dayPassCredit';
import { DayPassCreditEligibility } from './dayPassCredit';
import { GetDayPassCreditOfferUseCase } from './GetDayPassCreditOfferUseCase';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-12T12:00:00.000Z');

const useCaseFor = (dayPassExpiresAt: Date | null) => {
  const credits = new InMemoryDayPassCreditRepository();
  if (dayPassExpiresAt != null) {
    credits.seedDayPass(42, 'pi_day', dayPassExpiresAt);
  }
  return new GetDayPassCreditOfferUseCase(
    new DayPassCreditEligibility({
      credits,
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
};

describe('GetDayPassCreditOfferUseCase', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('reports the reduced price, both live prices and when the offer ends', async () => {
    const view = await useCaseFor(new Date(NOW.getTime() + 20 * HOUR)).execute(
      42
    );

    expect(view).toEqual({
      eligible: true,
      amount: 2350,
      currency: 'usd',
      display: '$23.50',
      semesterDisplay: '$29.50',
      dayPassDisplay: '$6',
      endsAt: new Date(NOW.getTime() + 44 * HOUR).toISOString(),
    });
  });

  it('reports only that there is no offer, without a reason or the Day Pass id', async () => {
    expect(await useCaseFor(null).execute(42)).toEqual({ eligible: false });
  });
});
