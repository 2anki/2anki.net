import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import SubscriptionService from '../../services/SubscriptionService';
import hashToken from '../../lib/misc/hashToken';
import { optionalMetadata } from './checkoutMetadata';
import { createCheckoutSession } from './createCheckoutSession';
import {
  CheckoutCustomerRefresher,
  recoverWith,
} from './StaleCheckoutCustomerRefresher';

export type AutoSyncCheckoutResult =
  | { url: string }
  | { status: 'cap_reached' | 'already_subscribed' };

const DEFAULT_MAX_SUBSCRIBERS = 50;

export class AutoSyncCheckoutUseCase {
  private readonly maxSubscribers: number;

  constructor(
    private readonly stripe: Pick<StripeTypes, 'checkout'>,
    private readonly priceId: string,
    private readonly productId: string,
    maxSubscribers?: number,
    private readonly refresher?: CheckoutCustomerRefresher
  ) {
    this.maxSubscribers = maxSubscribers ?? DEFAULT_MAX_SUBSCRIBERS;
  }

  async execute(input: {
    userEmail: string;
    userId: number;
    stripeCustomerId?: string | null;
    variant?: string;
    anonId?: string;
    surface?: string;
    gaClientId?: string;
  }): Promise<AutoSyncCheckoutResult> {
    console.info('auto_sync.checkout.started', { user_id: input.userId });

    const activeCount = await SubscriptionService.countActiveByProductId(
      this.productId
    );
    if (activeCount >= this.maxSubscribers) {
      console.info('auto_sync.checkout.cap_reached', {
        user_id: input.userId,
        active_count: activeCount,
        cap: this.maxSubscribers,
      });
      return { status: 'cap_reached' };
    }

    const existingSubs = await SubscriptionService.getUserActiveSubscriptions(
      input.userEmail
    );
    const alreadySubscribed = existingSubs.some(
      (s) =>
        s.active &&
        (s as { stripe_product_id?: string | null }).stripe_product_id ===
          this.productId
    );
    if (alreadySubscribed) {
      console.info('auto_sync.checkout.already_subscribed', {
        user_id: input.userId,
      });
      return { status: 'already_subscribed' };
    }

    const sessionParams: StripeTypes.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [{ price: this.priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL ?? 'https://2anki.net'}/ankify/setup`,
      cancel_url: `${process.env.APP_URL ?? 'https://2anki.net'}/pricing`,
      customer_email:
        input.stripeCustomerId == null ? input.userEmail : undefined,
      customer: input.stripeCustomerId ?? undefined,
      after_expiration: { recovery: { enabled: true } },
      subscription_data: { metadata: { user_id: String(input.userId) } },
      metadata: {
        user_id: String(input.userId),
        ...optionalMetadata({
          pricing_variant: input.variant,
          anon_id: input.anonId,
          surface: input.surface,
          ga_client_id: input.gaClientId,
        }),
      },
    };

    const session = await createCheckoutSession(
      this.stripe,
      sessionParams,
      recoverWith(this.refresher, input.userId, input.userEmail)
    );

    console.info('auto_sync.checkout.session_created', {
      user_id: input.userId,
      session_id_hash: hashToken(session.id ?? ''),
    });

    return { url: session.url! };
  }
}
