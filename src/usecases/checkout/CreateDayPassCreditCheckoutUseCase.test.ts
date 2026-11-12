import { vi } from 'vitest';
import { InMemoryDayPassCreditRepository } from '../../data_layer/DayPassCreditRepository';
import { InMemoryUserPassRepository } from '../../data_layer/UserPassRepository';
import { PricingService } from '../../services/PricingService';
import { nothingHeld, stripePassPrices } from '../../test/fakes/dayPassCredit';
import type { HeldEntitlements } from './resolvePurchaseBlock';
import { DayPassCreditEligibility } from './dayPassCredit';
import { CreateDayPassCreditCheckoutUseCase } from './CreateDayPassCreditCheckoutUseCase';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-12T12:00:00.000Z');

const dayPassHolder = nothingHeld({
  activePassKind: '24h',
  activePassExpiresAt: new Date(NOW.getTime() + 20 * HOUR),
});

const setup = (options: { held?: HeldEntitlements } = {}) => {
  const credits = new InMemoryDayPassCreditRepository();
  credits.seedDayPass(42, 'pi_day', new Date(NOW.getTime() + 20 * HOUR));
  let sessionCount = 0;
  const sessions = {
    create: vi.fn(async (_params: Record<string, unknown>) => {
      sessionCount += 1;
      return {
        id: `cs_${sessionCount}`,
        url: `https://checkout.stripe.com/c/cs_${sessionCount}`,
      };
    }),
    retrieve: vi.fn(),
    expire: vi.fn().mockResolvedValue({}),
  };
  const stripe = {
    checkout: { sessions },
    prices: stripePassPrices({
      '24h': { amount: 600 },
      '120d': { amount: 2900, product: 'prod_semester' },
    }),
  };
  const eligibility = new DayPassCreditEligibility({
    credits,
    passes: new InMemoryUserPassRepository(),
    sessions: sessions as never,
    pricing: new PricingService(stripe as never),
    heldEntitlements: async () => options.held ?? dayPassHolder,
    now: () => NOW,
  });
  const useCase = new CreateDayPassCreditCheckoutUseCase(
    stripe as never,
    eligibility,
    credits
  );
  return { credits, sessions, useCase };
};

const buyer = {
  userId: 42,
  userEmail: 'buyer@example.com',
  stripeCustomerId: 'cus_42',
};

describe('CreateDayPassCreditCheckoutUseCase', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('opens a Semester Pass checkout at the reduced price that the webhook grants as an ordinary 120d pass', async () => {
    const { sessions, useCase } = setup();

    const result = await useCase.execute(buyer);

    expect(result).toEqual({
      status: 'session',
      url: 'https://checkout.stripe.com/c/cs_1',
    });
    const params = sessions.create.mock.calls[0][0];
    expect(params).toMatchObject({
      mode: 'payment',
      customer: 'cus_42',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 2300,
            product: 'prod_semester',
          },
        },
      ],
      metadata: {
        pass_kind: '120d',
        user_id: '42',
        surface: 'day_pass_credit',
        day_pass_credit: '1',
      },
    });
    expect(String(params.success_url)).toContain(
      '/upload?from=pass&session_id='
    );
  });

  it('closes the checkout a day from now at most, so it cannot be paid long after it opened', async () => {
    const { sessions, useCase } = setup();

    await useCase.execute(buyer);

    expect(sessions.create.mock.calls[0][0].expires_at).toBe(
      Math.floor((NOW.getTime() + 23 * HOUR + 55 * 60 * 1000) / 1000)
    );
  });

  it('replaces an earlier checkout that Stripe no longer has', async () => {
    const { credits, sessions, useCase } = setup();
    const credit = await credits.claim(42, 'pi_day');
    await credits.attachSession(credit.id, null, 'cs_vanished');
    sessions.retrieve.mockRejectedValue(
      Object.assign(new Error('No such checkout.session'), {
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
      })
    );

    expect(await useCase.execute(buyer)).toEqual({
      status: 'session',
      url: 'https://checkout.stripe.com/c/cs_1',
    });
    expect(await credits.findByDayPass('pi_day')).toMatchObject({
      checkoutSessionId: 'cs_1',
    });
  });

  it('lets a Stripe failure reading the earlier checkout surface instead of opening another', async () => {
    const { credits, sessions, useCase } = setup();
    const credit = await credits.claim(42, 'pi_day');
    await credits.attachSession(credit.id, null, 'cs_open');
    sessions.retrieve.mockRejectedValue(
      Object.assign(new Error('api down'), { type: 'StripeAPIError' })
    );

    await expect(useCase.execute(buyer)).rejects.toThrow();
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('refuses when another request attached a checkout between the check and the claim', async () => {
    const { credits, sessions, useCase } = setup();
    const claim = credits.claim.bind(credits);
    vi.spyOn(credits, 'claim').mockImplementationOnce(async (userId, pi) => {
      const claimed = await claim(userId, pi);
      await credits.attachSession(claimed.id, null, 'cs_other');
      return { ...claimed, checkoutSessionId: 'cs_other' };
    });

    expect(await useCase.execute(buyer)).toEqual({
      status: 'refused',
      reason: 'checkout_open',
    });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('turns off Stripe checkout recovery so an expired upgrade cannot spawn a second payable session', async () => {
    const { sessions, useCase } = setup();

    await useCase.execute(buyer);

    expect(sessions.create.mock.calls[0][0]).not.toHaveProperty(
      'after_expiration'
    );
  });

  it('returns the open session instead of opening a second one', async () => {
    const { sessions, useCase } = setup();
    await useCase.execute(buyer);
    sessions.retrieve.mockResolvedValue({
      id: 'cs_1',
      status: 'open',
      url: 'https://checkout.stripe.com/c/cs_1',
    });

    const again = await useCase.execute(buyer);

    expect(again).toEqual({
      status: 'session',
      url: 'https://checkout.stripe.com/c/cs_1',
    });
    expect(sessions.retrieve).toHaveBeenCalledWith('cs_1');
    expect(sessions.create).toHaveBeenCalledTimes(1);
  });

  it('refuses once the upgrade session is paid, before the webhook has caught up', async () => {
    const { sessions, useCase } = setup();
    await useCase.execute(buyer);
    sessions.retrieve.mockResolvedValue({ id: 'cs_1', status: 'complete' });

    expect(await useCase.execute(buyer)).toEqual({
      status: 'refused',
      reason: 'credit_used',
    });
    expect(sessions.create).toHaveBeenCalledTimes(1);
  });

  it('opens a fresh session when the earlier one expired unpaid', async () => {
    const { sessions, useCase, credits } = setup();
    await useCase.execute(buyer);
    sessions.retrieve.mockResolvedValue({ id: 'cs_1', status: 'expired' });

    const again = await useCase.execute(buyer);

    expect(again).toEqual({
      status: 'session',
      url: 'https://checkout.stripe.com/c/cs_2',
    });
    expect(await credits.findByDayPass('pi_day')).toMatchObject({
      checkoutSessionId: 'cs_2',
    });
  });

  it('refuses a credit already redeemed', async () => {
    const { credits, sessions, useCase } = setup();
    const credit = await credits.claim(42, 'pi_day');
    await credits.attachSession(credit.id, null, 'cs_paid');
    await credits.markRedeemedBySession('cs_paid', NOW);

    expect(await useCase.execute(buyer)).toEqual({
      status: 'refused',
      reason: 'credit_used',
    });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not eligible, without touching Stripe checkout', async () => {
    const { sessions, useCase } = setup({
      held: nothingHeld({
        activePassKind: '120d',
        activePassExpiresAt: new Date('2027-03-01'),
      }),
    });

    expect(await useCase.execute(buyer)).toEqual({
      status: 'refused',
      reason: 'plan_held',
    });
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('expires the session it just opened when a parallel request attached one first', async () => {
    const { credits, sessions, useCase } = setup();
    sessions.create.mockImplementationOnce(async () => {
      const credit = await credits.claim(42, 'pi_day');
      await credits.attachSession(credit.id, null, 'cs_parallel');
      return { id: 'cs_late', url: 'https://checkout.stripe.com/c/cs_late' };
    });

    expect(await useCase.execute(buyer)).toEqual({
      status: 'refused',
      reason: 'checkout_open',
    });
    expect(sessions.expire).toHaveBeenCalledWith('cs_late');
    expect(await credits.findByDayPass('pi_day')).toMatchObject({
      checkoutSessionId: 'cs_parallel',
    });
  });
});
