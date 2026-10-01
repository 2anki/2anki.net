import { NextFunction, Request, Response } from 'express';

import UsersRepository from '../../data_layer/UsersRepository';
import { getDatabase } from '../../data_layer';
import { getStripe } from '../../lib/integrations/stripe';
import { StripeCustomerResolver } from '../../services/StripeCustomerResolver';

export interface ResolveStripeCustomerDeps {
  resolver: Pick<StripeCustomerResolver, 'resolveOrCreate'>;
}

// Checkout used to let Stripe mint a fresh customer per session, so one account
// accumulated several unrelated customer records (#4619). This resolves the
// account's own customer first and stashes it for the controller to pass as
// `customer`. Anonymous callers have no account to resolve and pass through. A
// transient Stripe failure degrades to the old behaviour rather than blocking
// the sale: the controller falls back to customer_email on a missing local.
export const makeResolveStripeCustomer = (deps: ResolveStripeCustomerDeps) => {
  return async (_req: Request, res: Response, next: NextFunction) => {
    const owner = res.locals.owner;
    const email = res.locals.email;
    if (owner == null || typeof email !== 'string' || email === '') {
      return next();
    }

    try {
      res.locals.stripeCustomerId = await deps.resolver.resolveOrCreate(
        Number(owner),
        email
      );
    } catch (error) {
      console.error('checkout.customer_resolve_failed', {
        user_id: Number(owner),
        error: (error as Error)?.message,
      });
    }
    return next();
  };
};

export const ResolveStripeCustomer = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const resolver = new StripeCustomerResolver(
      getStripe(),
      new UsersRepository(getDatabase())
    );
    return makeResolveStripeCustomer({ resolver })(req, res, next);
  };
};
