import { Response } from 'express';

import UsersRepository from '../../data_layer/UsersRepository';
import { getDatabase } from '../../data_layer';
import { getStripe } from '../../lib/integrations/stripe';
import { StripeCustomerResolver } from '../../services/StripeCustomerResolver';
import { getEventsSink } from '../../services/events/eventsSinkInstance';
import type { EventsSink } from '../../services/events/EventsSink';

export interface StripeCustomerResolution {
  resolveOrCreate(userId: number, email: string): Promise<string>;
}

// Checkout used to let Stripe mint a fresh customer per session, so one account
// accumulated several unrelated customer records (#4619). This resolves the
// account's own customer and stashes it for the controller to pass as
// `customer`. Called from the handler after the price-availability check so no
// customer is created for a request that then 404s or 503s. Anonymous callers
// have no account to resolve and pass through. A Stripe failure degrades to the
// old customer_email path rather than blocking the sale, and records a
// measurable outcome without logging any id.
export const applyResolvedStripeCustomer = async (
  res: Response,
  resolver: StripeCustomerResolution,
  eventsSink: Pick<EventsSink, 'record'>
): Promise<void> => {
  const owner = res.locals.owner;
  const email = res.locals.email;
  if (owner == null || typeof email !== 'string' || email === '') {
    return;
  }

  try {
    res.locals.stripeCustomerId = await resolver.resolveOrCreate(
      Number(owner),
      email
    );
  } catch (error) {
    console.error('checkout.customer_resolve_failed', {
      user_id: Number(owner),
      error_name: (error as Error)?.name,
      error_code: (error as { code?: string })?.code,
    });
    eventsSink.record({
      name: 'checkout_customer_resolve',
      user_id: Number(owner),
      props: { outcome: 'resolve_failed' },
    });
  }
};

export const resolveStripeCustomer = (res: Response): Promise<void> => {
  const resolver = new StripeCustomerResolver(
    getStripe(),
    new UsersRepository(getDatabase())
  );
  return applyResolvedStripeCustomer(res, resolver, getEventsSink());
};
