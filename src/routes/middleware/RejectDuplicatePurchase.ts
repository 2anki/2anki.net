import { NextFunction, Request, Response } from 'express';
import type { Knex } from 'knex';

import AuthenticationService from '../../services/AuthenticationService';
import TokenRepository from '../../data_layer/TokenRepository';
import UsersRepository from '../../data_layer/UsersRepository';
import UserPassRepository, {
  IUserPassRepository,
} from '../../data_layer/UserPassRepository';
import { getDatabase } from '../../data_layer';
import {
  HeldEntitlements,
  PurchaseKind,
  resolvePurchaseBlock,
} from '../../usecases/checkout/resolvePurchaseBlock';

export interface PurchaseGuardDeps {
  database: Knex;
  authService: Pick<AuthenticationService, 'getIsSubscriber'>;
  usersRepository: Pick<UsersRepository, 'getById'>;
  userPassRepository: IUserPassRepository;
  now: () => Date;
}

// Mirrors resolvePlanSource in configureUserLocal: an Apple-billed plan is an
// unlimited pass whose payment intent carries the apple: prefix. We cannot
// cancel or refund it, so it must never be bought over.
const isAppleBilled = (
  kind: string | null,
  paymentIntentId: string | undefined
): boolean =>
  kind === 'unlimited' && (paymentIntentId ?? '').startsWith('apple:');

export const readHeldEntitlements = async (
  owner: number,
  deps: PurchaseGuardDeps
): Promise<HeldEntitlements> => {
  const user = await deps.usersRepository.getById(String(owner));
  const email = user?.email ?? '';
  const activeSubscription =
    email === ''
      ? false
      : await deps.authService.getIsSubscriber(deps.database, email);
  const activePass = await deps.userPassRepository.findActive(
    owner,
    deps.now()
  );

  return {
    lifetime: user?.patreon === true,
    activeSubscription,
    billedThroughApple: isAppleBilled(
      activePass?.kind ?? null,
      activePass?.stripe_payment_intent_id
    ),
    activePassKind: activePass?.kind ?? null,
    activePassExpiresAt: activePass?.expires_at ?? null,
  };
};

// The checkout routes took nothing but an auth check, so anyone holding a plan
// could POST them and pay for a second one; only the UI stood in the way, and
// the UI has been wrong before (#4620). Anonymous callers pass through — there
// is no account to read an entitlement from.
export const makeRejectDuplicatePurchase = (
  kind: PurchaseKind,
  deps: PurchaseGuardDeps
) => {
  return async (_req: Request, res: Response, next: NextFunction) => {
    const owner = res.locals.owner;
    if (owner == null) {
      return next();
    }

    const held = await readHeldEntitlements(Number(owner), deps);
    const blocked = resolvePurchaseBlock(kind, held);
    if (blocked == null) {
      return next();
    }
    return res.status(409).json(blocked);
  };
};

export const RejectDuplicatePurchase = (kind: PurchaseKind) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const database = getDatabase();
    const guard = makeRejectDuplicatePurchase(kind, {
      database,
      authService: new AuthenticationService(
        new TokenRepository(database),
        new UsersRepository(database)
      ),
      usersRepository: new UsersRepository(database),
      userPassRepository: new UserPassRepository(database),
      now: () => new Date(),
    });
    return guard(req, res, next);
  };
};
