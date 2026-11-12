import { vi, type Mock } from 'vitest';
import type { Response } from 'express';
import { InMemoryDayPassCreditRepository } from '../data_layer/DayPassCreditRepository';
import { PricingService } from '../services/PricingService';
import { nothingHeld, stripePassPrices } from '../test/fakes/dayPassCredit';
import type { HeldEntitlements } from '../usecases/checkout/resolvePurchaseBlock';
import { DayPassCreditEligibility } from '../usecases/checkout/dayPassCredit';
import { CreateDayPassCreditCheckoutUseCase } from '../usecases/checkout/CreateDayPassCreditCheckoutUseCase';
import { GetDayPassCreditOfferUseCase } from '../usecases/checkout/GetDayPassCreditOfferUseCase';
import DayPassCreditController from './DayPassCreditController';

const HOUR = 60 * 60 * 1000;

const makeRes = () => {
  const res = {
    locals: { owner: 42, email: 'buyer@example.com' },
    json: vi.fn(),
    status: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & { json: Mock; status: Mock };
};

const request = () =>
  ({ cookies: {}, headers: {}, body: {}, ip: '203.0.113.9' }) as never;

const setup = (held: HeldEntitlements = nothingHeld()) => {
  const credits = new InMemoryDayPassCreditRepository();
  credits.seedDayPass(42, 'pi_day', new Date(Date.now() + 20 * HOUR));
  const stripe = {
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: 'cs_1',
          url: 'https://checkout.stripe.com/c/cs_1',
        }),
        retrieve: vi.fn(),
        expire: vi.fn(),
      },
    },
    prices: stripePassPrices({
      '24h': { amount: 600 },
      '120d': { amount: 2900 },
    }),
  };
  const eligibility = new DayPassCreditEligibility({
    credits,
    pricing: new PricingService(stripe as never),
    heldEntitlements: async () => held,
    now: () => new Date(),
  });
  const record = vi.fn();
  const controller = new DayPassCreditController(
    new GetDayPassCreditOfferUseCase(eligibility),
    new CreateDayPassCreditCheckoutUseCase(
      stripe as never,
      eligibility,
      credits
    ),
    { record }
  );
  return { controller, record, stripe };
};

describe('DayPassCreditController', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('serves the offer to an eligible Day Pass buyer', async () => {
    const { controller } = setup();
    const res = makeRes();

    await controller.getOffer(request(), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ eligible: true, display: '$23' })
    );
  });

  it('opens checkout and records checkout_started under the day_pass_credit surface', async () => {
    const { controller, record } = setup();
    const res = makeRes();

    await controller.createSession(request(), res);

    expect(res.json).toHaveBeenCalledWith({
      url: 'https://checkout.stripe.com/c/cs_1',
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'checkout_started',
        user_id: 42,
        props: expect.objectContaining({
          plan: '120d',
          surface: 'day_pass_credit',
        }),
      })
    );
  });

  it('answers 409 with a coded refusal when the caller is not eligible', async () => {
    const { controller, record, stripe } = setup(
      nothingHeld({ activeSubscription: true })
    );
    const res = makeRes();

    await controller.createSession(request(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      code: 'day_pass_credit_unavailable',
      message: 'This offer is not available on your account.',
    });
    expect(record).not.toHaveBeenCalled();
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('answers 503 when the live prices cannot be read', async () => {
    const { controller, stripe } = setup();
    stripe.prices.search.mockRejectedValue(new Error('stripe down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = makeRes();

    await controller.createSession(request(), res);

    expect(res.status).toHaveBeenCalledWith(503);
  });
});
