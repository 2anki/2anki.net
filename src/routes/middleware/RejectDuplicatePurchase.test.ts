import { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';

import {
  makeRejectDuplicatePurchase,
  PurchaseGuardDeps,
} from './RejectDuplicatePurchase';
import { PassKind, UserPass } from '../../data_layer/UserPassRepository';

const NOW = new Date('2026-10-01T00:00:00.000Z');
const EXPIRES = new Date('2026-10-08T00:00:00.000Z');

interface Held {
  patreon?: boolean;
  subscriber?: boolean;
  passKind?: PassKind | null;
  paymentIntentId?: string;
}

const makeDeps = (held: Held): PurchaseGuardDeps => {
  const pass: UserPass | null =
    held.passKind == null
      ? null
      : ({
          kind: held.passKind,
          expires_at: EXPIRES,
          stripe_payment_intent_id: held.paymentIntentId ?? 'pi_stripe',
        } as UserPass);

  return {
    database: {} as Knex,
    authService: {
      getIsSubscriber: async () => held.subscriber === true,
    } as PurchaseGuardDeps['authService'],
    usersRepository: {
      getById: async () =>
        ({
          email: 'learner@example.test',
          patreon: held.patreon === true,
        }) as Awaited<
          ReturnType<PurchaseGuardDeps['usersRepository']['getById']>
        >,
    },
    userPassRepository: {
      findActive: async () => pass,
    } as unknown as PurchaseGuardDeps['userPassRepository'],
    now: () => NOW,
  };
};

const run = async (
  kind: 'subscription' | 'pass',
  held: Held,
  owner: number | null
) => {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn().mockReturnThis();
  const next = jest.fn() as NextFunction;
  const res = { locals: { owner }, status, json } as unknown as Response;

  await makeRejectDuplicatePurchase(kind, makeDeps(held))(
    {} as Request,
    res,
    next
  );

  return { status, json, next };
};

describe('RejectDuplicatePurchase', () => {
  it('lets an anonymous caller through, since there is no account to read', async () => {
    const { next, status } = await run('pass', { subscriber: true }, null);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('lets a signed-in caller who owns nothing through', async () => {
    const { next, status } = await run('subscription', {}, 42);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('answers 409 with a renderable body when a subscriber buys again', async () => {
    const { next, status, json } = await run(
      'subscription',
      { subscriber: true },
      42
    );

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      code: 'already_subscribed',
      message: 'You already have an active subscription.',
      expiresAt: null,
    });
  });

  it('blocks a second pass and reports when the current one ends', async () => {
    const { status, json } = await run('pass', { passKind: '7d' }, 42);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      code: 'pass_still_active',
      message: 'Your pass is still running. Buy the next one when it runs out.',
      expiresAt: EXPIRES.toISOString(),
    });
  });

  it('lets a pass holder move to a subscription', async () => {
    const { next, status } = await run(
      'subscription',
      { passKind: '120d' },
      42
    );

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('reads an Apple-billed plan off the pass payment intent', async () => {
    const { status, json } = await run(
      'subscription',
      { passKind: 'unlimited', paymentIntentId: 'apple:1000000123' },
      42
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'billed_through_apple' })
    );
  });

  it('blocks a lifetime holder from buying a pass', async () => {
    const { status, json } = await run('pass', { patreon: true }, 42);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'already_lifetime' })
    );
  });
});
