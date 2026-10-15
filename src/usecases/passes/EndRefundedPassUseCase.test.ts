import { vi } from 'vitest';
import {
  EndRefundedPassUseCase,
  isFullRefund,
  type RefundedCharge,
} from './EndRefundedPassUseCase';
import { InMemoryAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import { InMemoryUserPassRepository } from '../../data_layer/UserPassRepository';
import type { EventsSink } from '../../services/events/EventsSink';

const NOW = new Date('2026-10-15T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function fullRefund(paymentIntentId: string | null): RefundedCharge {
  return { paymentIntentId, refunded: true, amount: 900, amountRefunded: 900 };
}

function partialRefund(paymentIntentId: string): RefundedCharge {
  return { paymentIntentId, refunded: false, amount: 900, amountRefunded: 300 };
}

function setup() {
  const userPassRepo = new InMemoryUserPassRepository();
  const anonPassRepo = new InMemoryAnonymousPassRepository();
  const eventsSink: Pick<EventsSink, 'record'> = { record: vi.fn() };
  const useCase = new EndRefundedPassUseCase(
    userPassRepo,
    anonPassRepo,
    eventsSink
  );
  return { userPassRepo, anonPassRepo, eventsSink, useCase };
}

describe('isFullRefund', () => {
  it.each([
    [{ refunded: true, amount: 900, amountRefunded: 900 }, true],
    [{ refunded: false, amount: 900, amountRefunded: 900 }, true],
    [{ refunded: false, amount: 900, amountRefunded: 899 }, false],
    [{ refunded: false, amount: 0, amountRefunded: 0 }, false],
  ])('%o -> %s', (charge, expected) => {
    expect(isFullRefund({ paymentIntentId: 'pi_1', ...charge })).toBe(expected);
  });
});

describe('EndRefundedPassUseCase', () => {
  it('ends a running account pass on a full refund and records the event', async () => {
    const { userPassRepo, eventsSink, useCase } = setup();
    userPassRepo.seed({
      user_id: 42,
      kind: '7d',
      expires_at: new Date(NOW.getTime() + 7 * DAY_MS),
      stripe_payment_intent_id: 'pi_refund',
    });

    const outcome = await useCase.execute(fullRefund('pi_refund'), NOW);

    expect(outcome).toEqual({
      status: 'ended',
      kind: '7d',
      endedUserPasses: 1,
      endedAnonymousPasses: 0,
    });
    expect(await userPassRepo.findActive(42, NOW)).toBeNull();
    expect(eventsSink.record).toHaveBeenCalledWith({
      name: 'pass_refunded',
      user_id: 42,
      props: { kind: '7d', full: true, access_ended: true },
      created_at: NOW,
    });
  });

  it('ends an unclaimed anonymous pass on a full refund', async () => {
    const { anonPassRepo, eventsSink, useCase } = setup();
    await anonPassRepo.insert({
      stripeSessionId: 'cs_anon',
      kind: '24h',
      expiresAt: new Date(NOW.getTime() + DAY_MS),
      paymentIntentId: 'pi_anon',
    });

    const outcome = await useCase.execute(fullRefund('pi_anon'), NOW);

    expect(outcome).toEqual({
      status: 'ended',
      kind: '24h',
      endedUserPasses: 0,
      endedAnonymousPasses: 1,
    });
    expect(await anonPassRepo.findActive('cs_anon', NOW)).toBeNull();
    expect(eventsSink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'pass_refunded',
        user_id: null,
        props: { kind: '24h', full: true, access_ended: true },
      })
    );
  });

  it('ends both rows of a claimed anonymous pass and attributes the claimer', async () => {
    const { userPassRepo, anonPassRepo, eventsSink, useCase } = setup();
    const anon = await anonPassRepo.insert({
      stripeSessionId: 'cs_claimed',
      kind: '120d',
      expiresAt: new Date(NOW.getTime() + 120 * DAY_MS),
      paymentIntentId: 'pi_claimed',
    });
    await anonPassRepo.claim(anon.id, 7);
    userPassRepo.seed({
      user_id: 7,
      kind: '120d',
      expires_at: new Date(NOW.getTime() + 120 * DAY_MS),
      stripe_payment_intent_id: 'pi_claimed',
    });

    const outcome = await useCase.execute(fullRefund('pi_claimed'), NOW);

    expect(outcome).toEqual({
      status: 'ended',
      kind: '120d',
      endedUserPasses: 1,
      endedAnonymousPasses: 1,
    });
    expect(await userPassRepo.findActive(7, NOW)).toBeNull();
    expect(eventsSink.record).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 7 })
    );
  });

  it('leaves the pass running on a partial refund and records it as partial', async () => {
    const { userPassRepo, eventsSink, useCase } = setup();
    const expiresAt = new Date(NOW.getTime() + 7 * DAY_MS);
    userPassRepo.seed({
      user_id: 42,
      kind: '7d',
      expires_at: expiresAt,
      stripe_payment_intent_id: 'pi_partial',
    });

    const outcome = await useCase.execute(partialRefund('pi_partial'), NOW);

    expect(outcome).toEqual({ status: 'partial_refund', kind: '7d' });
    const pass = await userPassRepo.findActive(42, NOW);
    expect(pass?.expires_at).toEqual(expiresAt);
    expect(eventsSink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'pass_refunded',
        props: { kind: '7d', full: false, access_ended: false },
      })
    );
  });

  it('does nothing for a payment intent with no pass (e.g. a subscription invoice)', async () => {
    const { userPassRepo, eventsSink, useCase } = setup();
    userPassRepo.seed({
      user_id: 42,
      kind: '7d',
      expires_at: new Date(NOW.getTime() + 7 * DAY_MS),
      stripe_payment_intent_id: 'pi_pass',
    });

    const outcome = await useCase.execute(fullRefund('pi_invoice'), NOW);

    expect(outcome).toEqual({ status: 'no_pass' });
    expect(await userPassRepo.findActive(42, NOW)).not.toBeNull();
    expect(eventsSink.record).not.toHaveBeenCalled();
  });

  it('does nothing when the charge has no payment intent', async () => {
    const { eventsSink, useCase } = setup();

    const outcome = await useCase.execute(fullRefund(null), NOW);

    expect(outcome).toEqual({ status: 'no_payment_intent' });
    expect(eventsSink.record).not.toHaveBeenCalled();
  });

  it('reports already_ended on a redelivered full refund without moving the expiry', async () => {
    const { userPassRepo, useCase } = setup();
    userPassRepo.seed({
      user_id: 42,
      kind: '24h',
      expires_at: new Date(NOW.getTime() + DAY_MS),
      stripe_payment_intent_id: 'pi_refund',
    });

    await useCase.execute(fullRefund('pi_refund'), NOW);
    const later = new Date(NOW.getTime() + 60_000);
    const second = await useCase.execute(fullRefund('pi_refund'), later);

    expect(second).toEqual({ status: 'already_ended', kind: '24h' });
    const pass = await userPassRepo.findByPaymentIntentId('pi_refund');
    expect(pass?.expires_at).toEqual(NOW);
  });
});
