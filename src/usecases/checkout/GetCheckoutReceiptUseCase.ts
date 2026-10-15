import type StripeTypes from 'stripe';

export type CheckoutReceiptKind =
  | 'pass_24h'
  | 'pass_7d'
  | 'pass_120d'
  | 'credit_pack'
  | 'subscription'
  | 'payment';

export interface CheckoutReceipt {
  amount: number;
  currency: string;
  kind: CheckoutReceiptKind;
  anonymous: boolean;
}

const isMissingSession = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === 'resource_missing';

function kindFor(session: StripeTypes.Checkout.Session): CheckoutReceiptKind {
  const meta = session.metadata ?? {};
  switch (meta.pass_kind) {
    case '24h':
      return 'pass_24h';
    case '7d':
      return 'pass_7d';
    case '120d':
      return 'pass_120d';
    default:
      break;
  }
  if (meta.credit_pack === '1') {
    return 'credit_pack';
  }
  return session.mode === 'subscription' ? 'subscription' : 'payment';
}

/**
 * What the success page may learn about a Checkout Session so it can report a
 * purchase conversion: amount, currency and what was bought. Nothing else
 * leaves Stripe. A session is readable by the signed-in user it belongs to,
 * or, for an anonymous pass, by whoever holds the session id (the same bearer
 * the pass itself already relies on).
 */
export class GetCheckoutReceiptUseCase {
  constructor(private readonly stripe: Pick<StripeTypes, 'checkout'>) {}

  async execute(input: {
    sessionId: string;
    ownerId: number | null;
  }): Promise<CheckoutReceipt | null> {
    let session: StripeTypes.Checkout.Session;
    try {
      session = await this.stripe.checkout.sessions.retrieve(input.sessionId);
    } catch (error) {
      if (isMissingSession(error)) {
        return null;
      }
      throw error;
    }
    if (session.payment_status !== 'paid') {
      return null;
    }
    const meta = session.metadata ?? {};
    const ownsSession =
      input.ownerId != null && meta.user_id === String(input.ownerId);
    const anonymousPass = meta.pass_anonymous === '1';
    if (!ownsSession && !anonymousPass) {
      return null;
    }
    return {
      amount: session.amount_total ?? 0,
      currency: (session.currency ?? 'usd').toUpperCase(),
      kind: kindFor(session),
      anonymous: !ownsSession,
    };
  }
}
