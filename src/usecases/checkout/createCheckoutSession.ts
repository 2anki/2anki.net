import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

export type RecoverStaleCustomer = (
  staleCustomerId: string
) => Promise<string | null>;

// Stripe reports a Checkout `customer` that no longer exists (e.g. deleted
// during duplicate cleanup in the dashboard) as a StripeInvalidRequestError
// with code 'resource_missing' and param 'customer'.
// https://docs.stripe.com/error-codes#resource-missing
export const isStaleCustomerError = (error: unknown): boolean => {
  const stripeError = error as { code?: string; param?: string };
  return (
    stripeError?.code === 'resource_missing' &&
    stripeError?.param === 'customer'
  );
};

// Centralises Checkout Session creation so a stored customer id that has gone
// stale cannot hard-fail checkout: on a missing-customer error the caller's
// recovery clears the stale id and resolves a fresh one, and the session is
// created once more with it. Logs an error code only — never a message, which
// carries the customer id.
export const createCheckoutSession = async (
  stripe: Pick<StripeTypes, 'checkout'>,
  params: StripeTypes.Checkout.SessionCreateParams,
  recoverStaleCustomer?: RecoverStaleCustomer
): Promise<StripeTypes.Checkout.Session> => {
  try {
    return await stripe.checkout.sessions.create(params);
  } catch (error) {
    const staleCustomer =
      typeof params.customer === 'string' ? params.customer : null;
    if (
      recoverStaleCustomer == null ||
      staleCustomer == null ||
      !isStaleCustomerError(error)
    ) {
      throw error;
    }
    console.warn('checkout.session.customer_refreshed', {
      error_code: (error as { code?: string }).code,
    });
    const fresh = await recoverStaleCustomer(staleCustomer);
    if (fresh == null || fresh === staleCustomer) {
      throw error;
    }
    return stripe.checkout.sessions.create({ ...params, customer: fresh });
  }
};
