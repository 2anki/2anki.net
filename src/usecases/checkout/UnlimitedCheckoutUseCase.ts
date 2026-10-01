import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import hashToken from '../../lib/misc/hashToken';
import { optionalMetadata } from './checkoutMetadata';
import { StripePriceResolver } from '../../services/StripePriceResolver';
import {
  LEGACY_LOCK_IN_WINDOW_END,
  PricingCohort,
  resolveCohort,
  V2_ANNUAL_LOOKUP_KEY,
  V2_MONTHLY_LOOKUP_KEY,
} from './pricingV2';
import { PricingResolutionError } from './PricingResolutionError';
import { createCheckoutSession } from './createCheckoutSession';
import {
  CheckoutCustomerRefresher,
  recoverWith,
} from './StaleCheckoutCustomerRefresher';

export type UnlimitedInterval = 'month' | 'year';

export interface UnlimitedCheckoutResult {
  url: string;
  cohort: PricingCohort;
}

export class UnlimitedCheckoutUseCase {
  constructor(
    private readonly stripe: Pick<StripeTypes, 'checkout'>,
    private readonly monthlyPriceId: string,
    private readonly yearlyPriceId: string,
    private readonly priceResolver?: StripePriceResolver,
    private readonly refresher?: CheckoutCustomerRefresher
  ) {}

  private async resolvePriceId(
    interval: UnlimitedInterval,
    cohort: PricingCohort,
    now: Date
  ): Promise<string> {
    const legacyId =
      interval === 'year' ? this.yearlyPriceId : this.monthlyPriceId;
    if (cohort === 'legacy' || this.priceResolver == null) {
      return legacyId;
    }
    const lookupKey =
      interval === 'year' ? V2_ANNUAL_LOOKUP_KEY : V2_MONTHLY_LOOKUP_KEY;
    const resolved = await this.priceResolver.resolveByLookupKey(lookupKey);
    if (resolved != null) {
      return resolved;
    }
    const legacyStillActive =
      now.getTime() < LEGACY_LOCK_IN_WINDOW_END.getTime();
    if (legacyStillActive) {
      console.error('unlimited.checkout.v2_resolve_fallback', {
        cohort,
        interval,
        lookup_key: lookupKey,
        reason: 'lookup_key resolution returned null, serving legacy price id',
      });
      return legacyId;
    }
    console.error('unlimited.checkout.v2_resolve_failed', {
      cohort,
      interval,
      lookup_key: lookupKey,
      reason:
        'lookup_key resolution returned null after the lock-in window; legacy price is archived, refusing to serve it',
    });
    throw new PricingResolutionError(lookupKey);
  }

  async execute(input: {
    userEmail: string;
    userId: number;
    interval: UnlimitedInterval;
    stripeCustomerId?: string | null;
    variant?: string;
    anonId?: string;
    surface?: string;
    gaClientId?: string;
    pricingV2On?: boolean;
    createdAt?: Date | null;
    now?: Date;
  }): Promise<UnlimitedCheckoutResult> {
    const now = input.now ?? new Date();
    const cohort = resolveCohort({
      flagOn: input.pricingV2On === true,
      createdAt: input.createdAt ?? null,
      now,
    });

    console.info('unlimited.checkout.started', {
      user_id: input.userId,
      interval: input.interval,
      cohort,
    });

    const priceId = await this.resolvePriceId(input.interval, cohort, now);
    const appUrl = process.env.APP_URL ?? 'https://2anki.net';

    const sessionParams: StripeTypes.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/upload`,
      cancel_url: `${appUrl}/pricing`,
      customer_email:
        input.stripeCustomerId == null ? input.userEmail : undefined,
      customer: input.stripeCustomerId ?? undefined,
      after_expiration: { recovery: { enabled: true } },
      subscription_data: { metadata: { user_id: String(input.userId) } },
      metadata: {
        user_id: String(input.userId),
        cohort,
        interval: input.interval,
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

    console.info('unlimited.checkout.session_created', {
      user_id: input.userId,
      interval: input.interval,
      cohort,
      session_id_hash: hashToken(session.id ?? ''),
    });

    return { url: session.url!, cohort };
  }
}
