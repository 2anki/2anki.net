import { Response } from 'express';

import UsersRepository from '../../data_layer/UsersRepository';
import { getDatabase } from '../../data_layer';
import { getStripe } from '../../lib/integrations/stripe';
import { StripeCustomerResolver } from '../../services/StripeCustomerResolver';
import { getEventsSink } from '../../services/events/eventsSinkInstance';

export interface StripeCustomerResolution {
  resolveOrCreate(userId: number, email: string): Promise<string>;
}

// Checkout used to let Stripe mint a fresh customer per session, so one account
// accumulated several unrelated customer records (#4619). This resolves the
// account's own customer and stashes it for the controller to pass as
// `customer`. Called from the handler after the price-availability check so no
// customer is created for a request that then 404s or 503s. Anonymous callers
// have no account to resolve and pass through. Building the resolver inside the
// try means a getStripe/getDatabase failure degrades to the old customer_email
// path like any other resolve failure rather than blocking the sale, and the
// outcome is recorded without logging any id.
export const applyResolvedStripeCustomer = async (
  res: Response,
  makeResolver: () => StripeCustomerResolution,
  recordFailure: (userId: number) => void
): Promise<void> => {
  const owner = res.locals.owner;
  const email = res.locals.email;
  if (owner == null || typeof email !== 'string' || email === '') {
    return;
  }

  const userId = Number(owner);
  try {
    const resolver = makeResolver();
    res.locals.stripeCustomerId = await resolver.resolveOrCreate(userId, email);
  } catch (error) {
    console.error('checkout.customer_resolve_failed', {
      user_id: userId,
      error_name: (error as Error)?.name,
      error_code: (error as { code?: string })?.code,
    });
    recordFailure(userId);
  }
};

export const resolveStripeCustomer = (res: Response): Promise<void> =>
  applyResolvedStripeCustomer(
    res,
    () =>
      new StripeCustomerResolver(
        getStripe(),
        new UsersRepository(getDatabase())
      ),
    (userId) => {
      try {
        getEventsSink().record({
          name: 'checkout_customer_resolve',
          user_id: userId,
          props: { outcome: 'resolve_failed' },
        });
      } catch (error) {
        console.error('checkout.customer_resolve_event_failed', {
          error_name: (error as Error)?.name,
        });
      }
    }
  );
