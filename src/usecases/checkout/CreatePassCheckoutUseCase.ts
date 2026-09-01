import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import type { PassKind } from '../../data_layer/UserPassRepository';
import { optionalMetadata } from './checkoutMetadata';

export interface CreatePassCheckoutResult {
  url: string;
}

export class CreatePassCheckoutUseCase {
  constructor(
    private readonly stripe: Pick<StripeTypes, 'checkout'>,
    private readonly priceId: string,
    private readonly passKind: PassKind
  ) {}

  async execute(input: {
    userEmail?: string;
    userId?: number;
    stripeCustomerId?: string | null;
    variant?: string;
    anonId?: string;
    surface?: string;
    gaClientId?: string;
  }): Promise<CreatePassCheckoutResult> {
    const appUrl = process.env.APP_URL ?? 'https://2anki.net';
    const isAnonymous = input.userId == null;

    const successUrl = isAnonymous
      ? `${appUrl}/upload?pass_session={CHECKOUT_SESSION_ID}`
      : `${appUrl}/upload?from=pass`;

    const metadata: Record<string, string> = { pass_kind: this.passKind };
    if (isAnonymous) {
      metadata.pass_anonymous = '1';
    } else {
      metadata.user_id = String(input.userId);
    }
    Object.assign(
      metadata,
      optionalMetadata({
        pricing_variant: input.variant,
        anon_id: input.anonId,
        surface: input.surface,
        ga_client_id: input.gaClientId,
      })
    );

    const sessionParams: StripeTypes.Checkout.SessionCreateParams = {
      mode: 'payment',
      invoice_creation: { enabled: true },
      line_items: [{ price: this.priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: `${appUrl}/pricing`,
      after_expiration: { recovery: { enabled: true } },
      metadata,
    };

    if (isAnonymous) {
      sessionParams.custom_fields = [
        {
          key: 'account_email',
          label: {
            type: 'custom',
            custom: 'Your 2anki account email (optional)',
          },
          type: 'text',
          optional: true,
        },
      ];
    } else {
      sessionParams.customer_email =
        input.stripeCustomerId == null ? input.userEmail : undefined;
      sessionParams.customer = input.stripeCustomerId ?? undefined;
    }

    const session = await this.stripe.checkout.sessions.create(sessionParams);

    return { url: session.url! };
  }
}
