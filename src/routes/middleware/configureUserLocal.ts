import { Request, Response } from 'express';
import AuthenticationService, {
  UserWithOwner,
} from '../../services/AuthenticationService';
import { Knex } from 'knex';
import UserPassRepository, {
  IUserPassRepository,
  UserPass,
} from '../../data_layer/UserPassRepository';
import {
  IAnonymousPassRepository,
  AnonymousPassRepository,
} from '../../data_layer/AnonymousPassRepository';
import { ValidateAnonymousPassUseCase } from '../../usecases/checkout/ValidateAnonymousPassUseCase';
import { ClaimPassFromTokenUseCase } from '../../usecases/passes/ClaimPassFromTokenUseCase';
import { getStripe } from '../../lib/integrations/stripe';
import { getEventsSink } from '../../services/events/eventsSinkInstance';

export type PlanSource = 'stripe' | 'apple' | 'lifetime' | null;

function resolvePlanSource(
  isSubscriber: boolean,
  activePass: UserPass | null,
  patreon: boolean
): PlanSource {
  if (isSubscriber) {
    return 'stripe';
  }
  if (
    activePass?.kind === 'unlimited' &&
    activePass.stripe_payment_intent_id.startsWith('apple:')
  ) {
    return 'apple';
  }
  if (patreon === true) {
    return 'lifetime';
  }
  return null;
}

function resolveStripe() {
  const key = process.env.STRIPE_KEY;
  if (key == null || key === '') {
    return undefined;
  }
  return getStripe();
}

/**
 * Populate `res.locals` from a resolved user for the session-cookie path, so
 * every downstream quota/paying check reads a single trusted locals shape.
 */
export async function applyUserLocals(
  res: Response,
  user: UserWithOwner,
  authService: AuthenticationService,
  database: Knex,
  now?: Date,
  userPassRepo?: IUserPassRepository
) {
  res.locals.owner = user.owner;
  res.locals.email = user.email;
  res.locals.patreon = user.patreon;
  res.locals.chat_consent_at = user.chat_consent_at ?? null;
  const isSubscriber = await authService.getIsSubscriber(database, user.email);
  let activePass: UserPass | null = null;
  if (isSubscriber) {
    res.locals.subscriber = true;
  } else {
    const passRepo = userPassRepo ?? new UserPassRepository(database);
    activePass = await passRepo.findActive(user.owner, now ?? new Date());
    res.locals.subscriber = activePass != null;
    res.locals.passExpiresAt = activePass?.expires_at.toISOString() ?? null;
    res.locals.passKind = activePass?.kind ?? null;
  }
  res.locals.planSource = resolvePlanSource(
    isSubscriber,
    activePass,
    user.patreon === true
  );
  res.locals.subscriptionInfo = await authService.getSubscriptionInfo(
    database,
    user.email
  );
}

// A buyer who paid without an account and then signs up in the same browser
// still sends the pass token. Claiming it here is what keeps the pass working
// on the first signed-in request. A failed claim must not fail the request:
// the emailed claim link and the ops grant still reach the same pass.
async function claimPassForUser(
  claimPass: ClaimPassFromTokenUseCase,
  owner: number,
  passToken: string,
  now?: Date
) {
  try {
    await claimPass.execute(owner, passToken, now ?? new Date());
  } catch (error) {
    console.error('[pass] session claim failed', error);
  }
}

export async function configureUserLocal(
  req: Request,
  res: Response,
  authService: AuthenticationService,
  database: Knex,
  anonPassRepo?: IAnonymousPassRepository,
  now?: Date,
  validateAnonymousPass?: ValidateAnonymousPassUseCase,
  userPassRepo?: IUserPassRepository
) {
  const passToken = req.headers['x-pass-token'];
  const hasPassToken = typeof passToken === 'string' && passToken.length > 0;
  const repo = () => anonPassRepo ?? new AnonymousPassRepository(database);
  const validator = () =>
    validateAnonymousPass ??
    new ValidateAnonymousPassUseCase(repo(), resolveStripe());

  const user = await authService.getUserFrom(req.cookies.token);
  if (user) {
    if (hasPassToken) {
      await claimPassForUser(
        new ClaimPassFromTokenUseCase(
          validator(),
          repo(),
          userPassRepo ?? new UserPassRepository(database),
          getEventsSink()
        ),
        user.owner,
        passToken,
        now
      );
    }
    await applyUserLocals(res, user, authService, database, now, userPassRepo);
    return;
  }

  if (hasPassToken) {
    const result = await validator().execute(passToken, now ?? new Date());
    if (result.valid && result.pass != null) {
      res.locals.subscriber = true;
      res.locals.passKind = result.pass.kind;
      res.locals.passExpiresAt = result.pass.expires_at.toISOString();
      res.locals.anonymousPassId = result.pass.id;
    }
  }
}
