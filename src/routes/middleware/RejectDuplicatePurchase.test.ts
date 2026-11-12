import { vi } from 'vitest';
import { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';

import {
  makeRejectDuplicatePurchase,
  PurchaseGuardDeps,
} from './RejectDuplicatePurchase';
import {
  InMemoryUserPassRepository,
  PassKind,
  UserPass,
} from '../../data_layer/UserPassRepository';
import { PASS_DURATION_MS } from '../../usecases/passes/passDurations';

const NOW = new Date('2026-10-01T00:00:00.000Z');
const EXPIRES = new Date('2026-10-08T00:00:00.000Z');

interface Held {
  patreon?: boolean;
  subscriber?: boolean;
  unprovenPlan?: boolean;
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
      holdsUnprovenPlan: async () => held.unprovenPlan === true,
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
      findActivePasses: async () =>
        pass == null ? [] : [{ kind: pass.kind, expiresAt: pass.expires_at }],
    } as unknown as PurchaseGuardDeps['userPassRepository'],
    now: () => NOW,
  };
};

const run = async (
  kind: 'subscription' | 'pass' | 'semester_pass' | 'auto_sync',
  held: Held,
  owner: number | null
) => {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const next = vi.fn() as NextFunction;
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

  it.each(['subscription', 'pass', 'semester_pass', 'auto_sync'] as const)(
    'answers 409 to a %s over a live plan the account has not proven',
    async (kind) => {
      const { next, status, json } = await run(
        kind,
        { unprovenPlan: true },
        42
      );

      expect(next).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(409);
      expect(json).toHaveBeenCalledWith({
        code: 'confirm_address',
        message:
          'A plan is already billed to this email. Confirm this email with a sign-in link, then try again.',
        expiresAt: null,
      });
    }
  );

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

describe('RejectDuplicatePurchase Semester Pass renewal', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const USER_ID = 42;

  const guardWith = (passes: InMemoryUserPassRepository, now: Date) => {
    const deps = {
      ...makeDeps({}),
      userPassRepository: passes,
      now: () => now,
    };
    return async () => {
      const status = vi.fn().mockReturnThis();
      const json = vi.fn().mockReturnThis();
      const next = vi.fn() as NextFunction;
      const res = {
        locals: { owner: USER_ID },
        status,
        json,
      } as unknown as Response;
      await makeRejectDuplicatePurchase('semester_pass', deps)(
        {} as Request,
        res,
        next
      );
      return { status, json, next };
    };
  };

  const seedSemesterPass = (expiresAt: Date) => {
    const passes = new InMemoryUserPassRepository();
    passes.seed({
      user_id: USER_ID,
      kind: '120d',
      expires_at: expiresAt,
      stripe_payment_intent_id: 'pi_first_semester',
    });
    return passes;
  };

  it('lets a holder with 5 days left start a renewal checkout', async () => {
    const passes = seedSemesterPass(new Date(NOW.getTime() + 5 * DAY_MS));

    const { next, status } = await guardWith(passes, NOW)();

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('blocks a holder with 8 days left, as before', async () => {
    const passes = seedSemesterPass(new Date(NOW.getTime() + 8 * DAY_MS));

    const { next, status, json } = await guardWith(passes, NOW)();

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'pass_still_active' })
    );
  });

  it('blocks a Semester Pass checkout while a Week Pass runs out this week', async () => {
    const passes = new InMemoryUserPassRepository();
    passes.seed({
      user_id: USER_ID,
      kind: '7d',
      expires_at: new Date(NOW.getTime() + 3 * DAY_MS),
      stripe_payment_intent_id: 'pi_week',
    });

    const { status } = await guardWith(passes, NOW)();

    expect(status).toHaveBeenCalledWith(409);
  });

  it('blocks a renewal for an Apple-billed holder whose Semester Pass ends later', async () => {
    const passes = seedSemesterPass(new Date(NOW.getTime() + 5 * DAY_MS));
    passes.seed({
      user_id: USER_ID,
      kind: 'unlimited',
      expires_at: new Date(NOW.getTime() + 3 * DAY_MS),
      stripe_payment_intent_id: 'apple:2000000000000001',
    });

    const { next, status } = await guardWith(passes, NOW)();

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(409);
  });

  it('lets the holder of a Semester Pass bought in the iOS app renew on the web', async () => {
    const passes = new InMemoryUserPassRepository();
    passes.seed({
      user_id: USER_ID,
      kind: '120d',
      expires_at: new Date(NOW.getTime() + 5 * DAY_MS),
      stripe_payment_intent_id: 'apple:2000000000000002',
    });

    const { next, status } = await guardWith(passes, NOW)();

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('stacks the renewal onto the current expiry, then blocks a second renewal', async () => {
    const currentExpiry = new Date(NOW.getTime() + 5 * DAY_MS);
    const passes = seedSemesterPass(currentExpiry);

    const renewal = await passes.upsertWithExtension(
      USER_ID,
      '120d',
      PASS_DURATION_MS['120d'],
      'pi_renewal',
      NOW
    );

    expect(renewal.expires_at).toEqual(
      new Date(currentExpiry.getTime() + PASS_DURATION_MS['120d'])
    );
    const { status, json } = await guardWith(passes, NOW)();
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'pass_still_active',
        expiresAt: renewal.expires_at.toISOString(),
      })
    );
  });
});
