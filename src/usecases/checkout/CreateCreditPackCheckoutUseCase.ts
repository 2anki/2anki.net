import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import { optionalMetadata } from './checkoutMetadata';
import { CreditPackSource, resolveCreditPackRedirect } from './creditPack';

export interface CreateCreditPackCheckoutResult {
  url: string;
}

export class CreateCreditPackCheckoutUseCase {
  constructor(
    private readonly stripe: Pick<StripeTypes, 'checkout'>,
    private readonly priceId: string
  ) {}

  async execute(input: {
    userId: number;
    userEmail?: string;
    stripeCustomerId?: string | null;
    source?: CreditPackSource;
    gaClientId?: string;
  }): Promise<CreateCreditPackCheckoutResult> {
    const appUrl = process.env.APP_URL ?? 'https://2anki.net';
    const { successUrl, cancelUrl } = resolveCreditPackRedirect(
      input.source,
      appUrl
    );

    const metadata: Record<string, string> = {
      credit_pack: '1',
      user_id: String(input.userId),
    };
    Object.assign(
      metadata,
      optionalMetadata({
        surface: input.source,
        ga_client_id: input.gaClientId,
      })
    );

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      invoice_creation: { enabled: true },
      line_items: [{ price: this.priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email:
        input.stripeCustomerId == null ? input.userEmail : undefined,
      customer: input.stripeCustomerId ?? undefined,
      metadata,
    });

    return { url: session.url! };
  }
}
