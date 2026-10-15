import type StripeTypes from 'stripe';
import SubscriptionService from '../../services/SubscriptionService';
import hashToken from '../../lib/misc/hashToken';
import { optionalMetadata } from './checkoutMetadata';
import type { AdClickAttribution } from '../../lib/attribution/adClick';
import { createCheckoutSession } from './createCheckoutSession';
import {
  CheckoutCustomerRefresher,
  recoverWith,
} from './StaleCheckoutCustomerRefresher';

export type AutoSyncCheckoutResult =
  | { url: string }
  | { status: 'cap_reached' | 'already_subscribed' | 'upgrade_unavailable' };

const DEFAULT_MAX_SUBSCRIBERS = 50;

export class AutoSyncCheckoutUseCase {
  private readonly maxSubscribers: number;

  constructor(
    private readonly stripe: Pick<
      StripeTypes,
      'checkout' | 'subscriptions' | 'billingPortal'
    >,
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
    adClick?: AdClickAttribution;
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

    // The subscriptions table keeps one row per email, so a second Stripe
    // subscription beside Pro would overwrite the Pro row, and cancelling
    // either would switch both off. A Pro subscriber switches their existing
    // subscription to the Auto Sync price instead, on Stripe's confirm page,
    // which shows the proration before anything is charged.
    if (existingSubs.length > 0) {
      return this.switchExistingSubscription(
        existingSubs,
        input.userId,
        input.stripeCustomerId ?? null
      );
    }

    const sessionParams: StripeTypes.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [{ price: this.priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL ?? 'https://2anki.net'}/ankify/setup?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
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
          ...input.adClick,
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

  private async switchExistingSubscription(
    rows: Array<{ payload: unknown }>,
    userId: number,
    accountCustomerId: string | null
  ): Promise<AutoSyncCheckoutResult> {
    const subscriptionId = rows
      .map((row) => stripeSubscriptionId(row.payload))
      .find((id) => id != null);
    if (subscriptionId == null) {
      console.info('auto_sync.checkout.upgrade_unavailable', {
        user_id: userId,
        reason: 'no_subscription_id',
      });
      return { status: 'upgrade_unavailable' };
    }

    const subscription =
      await this.stripe.subscriptions.retrieve(subscriptionId);
    const items = subscription.items?.data ?? [];
    if (items.length !== 1) {
      console.info('auto_sync.checkout.upgrade_unavailable', {
        user_id: userId,
        reason: 'item_count',
        item_count: items.length,
      });
      return { status: 'upgrade_unavailable' };
    }

    const customer =
      typeof subscription.customer === 'string'
        ? subscription.customer
        : subscription.customer.id;
    // Rows match on linked_email as well as email, so the subscription found
    // can belong to a different Stripe customer. A portal session shows that
    // customer's cards and invoices, so it opens only for the account's own.
    if (accountCustomerId == null || customer !== accountCustomerId) {
      console.info('auto_sync.checkout.upgrade_unavailable', {
        user_id: userId,
        reason: 'customer_mismatch',
      });
      return { status: 'upgrade_unavailable' };
    }

    const appUrl = process.env.APP_URL ?? 'https://2anki.net';
    const session = await this.stripe.billingPortal.sessions.create({
      customer,
      return_url: `${appUrl}/pricing`,
      flow_data: {
        type: 'subscription_update_confirm',
        subscription_update_confirm: {
          subscription: subscription.id,
          items: [{ id: items[0].id, price: this.priceId, quantity: 1 }],
        },
        after_completion: {
          type: 'redirect',
          redirect: { return_url: `${appUrl}/ankify/setup` },
        },
      },
    });

    console.info('auto_sync.checkout.upgrade_session_created', {
      user_id: userId,
      session_id_hash: hashToken(session.id ?? ''),
    });

    return { url: session.url };
  }
}

function stripeSubscriptionId(payload: unknown): string | null {
  let parsed = payload;
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  const id = (parsed as { id?: unknown } | null)?.id;
  return typeof id === 'string' && id.startsWith('sub_') ? id : null;
}
