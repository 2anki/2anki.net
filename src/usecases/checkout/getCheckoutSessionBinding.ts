import type StripeTypes from 'stripe';
import type { CheckoutPreviewBinding } from '../uploads/ResumeAnonymousAiPreviewUseCase';

// Reads the ai-preview binding straight from a checkout session's metadata —
// the anon id and surface CreatePassCheckoutUseCase stamped at purchase. This
// is the server-trusted record of who bought the pass and from which flow, used
// to bind an AI-preview resume to the file it was actually bought for instead
// of trusting a client cookie. Returns nulls when Stripe is unavailable or the
// values are absent, so the caller fails closed (no resume).
export async function getCheckoutSessionBinding(
  stripe: Pick<StripeTypes, 'checkout'> | undefined,
  stripeSessionId: string
): Promise<CheckoutPreviewBinding> {
  if (stripe == null || !stripeSessionId.startsWith('cs_')) {
    return { anonId: null, surface: null };
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    const meta = (session.metadata ?? {}) as Record<string, string>;
    const anonId =
      typeof meta.anon_id === 'string' && meta.anon_id.length > 0
        ? meta.anon_id
        : null;
    const surface =
      typeof meta.surface === 'string' && meta.surface.length > 0
        ? meta.surface
        : null;
    return { anonId, surface };
  } catch {
    return { anonId: null, surface: null };
  }
}
