import type StripeTypes from 'stripe';

// Reads the buyer's anon id straight from a checkout session's metadata — the
// value CreatePassCheckoutUseCase stamped at purchase. This is the server-
// trusted identity of who bought the pass, used to bind an AI-preview resume to
// the file it was actually bought for instead of trusting a client cookie.
// Returns null when Stripe is unavailable or the id is absent, so the caller
// fails closed (no resume).
export async function getCheckoutSessionAnonId(
  stripe: Pick<StripeTypes, 'checkout'> | undefined,
  stripeSessionId: string
): Promise<string | null> {
  if (stripe == null || !stripeSessionId.startsWith('cs_')) {
    return null;
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    const anonId = ((session.metadata ?? {}) as Record<string, string>).anon_id;
    return typeof anonId === 'string' && anonId.length > 0 ? anonId : null;
  } catch {
    return null;
  }
}
