import { vi } from 'vitest';
import { ClaimPassFromTokenUseCase } from './ClaimPassFromTokenUseCase';
import { InMemoryAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import { InMemoryUserPassRepository } from '../../data_layer/UserPassRepository';
import { ValidateAnonymousPassUseCase } from '../checkout/ValidateAnonymousPassUseCase';
import type { EventsSink } from '../../services/events/EventsSink';
import { emailHash } from '../../lib/emailHash';

const NOW = new Date('2026-10-22T00:28:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const BUYER_EMAIL = 'buyer@example.com';

function build(refunded: ReadonlySet<string> = new Set()) {
  const anonRepo = new InMemoryAnonymousPassRepository(refunded);
  const userPassRepo = new InMemoryUserPassRepository(refunded);
  const eventsSink: Pick<EventsSink, 'record'> = { record: vi.fn() };
  const useCase = new ClaimPassFromTokenUseCase(
    new ValidateAnonymousPassUseCase(anonRepo),
    anonRepo,
    userPassRepo,
    eventsSink
  );
  return { anonRepo, userPassRepo, eventsSink, useCase };
}

async function insertActivePass(
  anonRepo: InMemoryAnonymousPassRepository,
  sessionId: string,
  paymentIntentId: string,
  buyerEmail: string | null = BUYER_EMAIL
) {
  const pass = await anonRepo.insert({
    stripeSessionId: sessionId,
    kind: '24h',
    expiresAt: new Date(NOW.getTime() + 30 * DAY_MS),
    paymentIntentId,
    buyerEmailHash: buyerEmail == null ? undefined : emailHash(buyerEmail),
  });
  const activatedExpiry = new Date(NOW.getTime() - 60_000 + DAY_MS);
  await anonRepo.activate(
    pass.id,
    new Date(NOW.getTime() - 60_000),
    activatedExpiry
  );
  return { pass, activatedExpiry };
}

describe('ClaimPassFromTokenUseCase', () => {
  it('moves an unclaimed pass to the signed-in account and keeps its window', async () => {
    const { anonRepo, userPassRepo, eventsSink, useCase } = build();
    const { pass, activatedExpiry } = await insertActivePass(
      anonRepo,
      'cs_buyer',
      'pi_buyer'
    );

    const claimed = await useCase.execute(42, BUYER_EMAIL, 'cs_buyer', NOW);

    expect(claimed).toBe(true);
    expect((await anonRepo.findById(pass.id))?.claimed_by_user_id).toBe(42);
    const userPass = await userPassRepo.findActive(42, NOW);
    expect(userPass).toMatchObject({
      kind: '24h',
      expires_at: activatedExpiry,
      stripe_payment_intent_id: 'pi_buyer',
    });
    expect(eventsSink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'anonymous_pass_claimed',
        user_id: 42,
        props: { kind: '24h', method: 'session' },
      })
    );
  });

  it('matches the buyer email regardless of case and spacing', async () => {
    const { anonRepo, useCase } = build();
    await insertActivePass(anonRepo, 'cs_case', 'pi_case');

    const claimed = await useCase.execute(
      42,
      ' Buyer@Example.com',
      'cs_case',
      NOW
    );

    expect(claimed).toBe(true);
  });

  it.each([
    ['a different email', 'someone-else@example.com'],
    ['no buyer email on the pass', null],
  ])(
    'leaves the pass unclaimed when the account has %s',
    async (_label, buyerEmail) => {
      const { anonRepo, userPassRepo, useCase } = build();
      const { pass } = await insertActivePass(
        anonRepo,
        'cs_shared',
        'pi_shared',
        buyerEmail === null ? null : buyerEmail
      );

      const claimed = await useCase.execute(42, BUYER_EMAIL, 'cs_shared', NOW);

      expect(claimed).toBe(false);
      expect((await anonRepo.findById(pass.id))?.claimed_by_user_id).toBeNull();
      expect(await userPassRepo.findActive(42, NOW)).toBeNull();
    }
  );

  it('leaves a pass claimed by another account where it is', async () => {
    const { anonRepo, userPassRepo, useCase } = build();
    const { pass } = await insertActivePass(anonRepo, 'cs_other', 'pi_other');
    await anonRepo.claim(pass.id, 7);

    const claimed = await useCase.execute(42, BUYER_EMAIL, 'cs_other', NOW);

    expect(claimed).toBe(false);
    expect((await anonRepo.findById(pass.id))?.claimed_by_user_id).toBe(7);
    expect(await userPassRepo.findActive(42, NOW)).toBeNull();
  });

  it('does not claim a refunded pass', async () => {
    const { anonRepo, userPassRepo, useCase } = build(new Set(['pi_refunded']));
    await anonRepo.insert({
      stripeSessionId: 'cs_refunded',
      kind: '24h',
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      paymentIntentId: 'pi_refunded',
      buyerEmailHash: emailHash(BUYER_EMAIL),
    });

    const claimed = await useCase.execute(42, BUYER_EMAIL, 'cs_refunded', NOW);

    expect(claimed).toBe(false);
    expect(await userPassRepo.findActive(42, NOW)).toBeNull();
  });

  it('does not claim an unknown token', async () => {
    const { userPassRepo, useCase } = build();

    const claimed = await useCase.execute(42, BUYER_EMAIL, 'cs_unknown', NOW);

    expect(claimed).toBe(false);
    expect(await userPassRepo.findActive(42, NOW)).toBeNull();
  });

  it('releases the claim when the account pass cannot be written', async () => {
    const { anonRepo, userPassRepo, useCase } = build();
    const { pass } = await insertActivePass(anonRepo, 'cs_fail', 'pi_fail');
    vi.spyOn(userPassRepo, 'upsertWithAbsoluteExpiry').mockRejectedValue(
      new Error('db down')
    );

    await expect(
      useCase.execute(42, BUYER_EMAIL, 'cs_fail', NOW)
    ).rejects.toThrow(Error);
    expect((await anonRepo.findById(pass.id))?.claimed_by_user_id).toBeNull();
  });
});
