import type StripeTypes from 'stripe';
import hashToken from '../../lib/misc/hashToken';
import { optionalMetadata } from './checkoutMetadata';
import type { AdClickAttribution } from '../../lib/attribution/adClick';
import { StripePriceResolver } from '../../services/StripePriceResolver';
import {
  PRICING_COHORT,
  PricingCohort,
  V2_ANNUAL_LOOKUP_KEY,
  V2_MONTHLY_LOOKUP_KEY,
} from './pricingV2';
import { PricingResolutionError } from './PricingResolutionError';
import { createCheckoutSession } from './createCheckoutSession';
import {
  CheckoutCustomerRefresher,
  recoverWith,
} from './StaleCheckoutCustomerRefresher';
import {
  LapsedSubscriptionError,
  LapsedSubscriptionGateway,
} from './LapsedSubscriptions';

export type UnlimitedInterval = 'month' | 'year';

export interface UnlimitedCheckoutResult {
  url: string;
  cohort: PricingCohort;
}

export class UnlimitedCheckoutUseCase {
  constructor(
    private readonly stripe: Pick<StripeTypes, 'checkout'>,
    private readonly priceResolver: Pick<
      StripePriceResolver,
      'resolveByLookupKey'
    >,
    private readonly refresher?: CheckoutCustomerRefresher,
    private readonly lapsed?: LapsedSubscriptionGateway
  ) {}

  // A plan whose last payment failed is still open in Stripe. Selling a new
  // one on top would either fail (another currency) or bill twice, so the
  // person first chooses: pay the old plan, or end it and switch. Only an
  // explicit switch (replaceLapsed) ends it.
  private async settleLapsedPlans(
    customerId: string | null | undefined,
    replaceLapsed: boolean,
    userId: number
  ): Promise<void> {
    if (this.lapsed == null || customerId == null) {
      return;
    }
    const plans = await this.lapsed.find(customerId);
    if (plans.length === 0) {
      return;
    }
    if (!replaceLapsed) {
      console.info('unlimited.checkout.lapsed_plan_found', {
        user_id: userId,
        count: plans.length,
      });
      throw new LapsedSubscriptionError(plans[0]);
    }
    await this.lapsed.close(plans);
    console.info('unlimited.checkout.lapsed_plan_closed', {
      user_id: userId,
      count: plans.length,
    });
  }

  private async resolvePriceId(interval: UnlimitedInterval): Promise<string> {
    const lookupKey =
      interval === 'year' ? V2_ANNUAL_LOOKUP_KEY : V2_MONTHLY_LOOKUP_KEY;
    const resolved = await this.priceResolver.resolveByLookupKey(lookupKey);
    if (resolved != null) {
      return resolved;
    }
    console.error('unlimited.checkout.v2_resolve_failed', {
      cohort: PRICING_COHORT,
      interval,
      lookup_key: lookupKey,
      reason:
        'lookup_key resolution returned null; refusing to create a session without a v2 price',
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
    gaSessionId?: string;
    adClick?: AdClickAttribution;
    replaceLapsed?: boolean;
  }): Promise<UnlimitedCheckoutResult> {
    const cohort = PRICING_COHORT;

    console.info('unlimited.checkout.started', {
      user_id: input.userId,
      interval: input.interval,
      cohort,
    });

    const priceId = await this.resolvePriceId(input.interval);
    await this.settleLapsedPlans(
      input.stripeCustomerId,
      input.replaceLapsed === true,
      input.userId
    );
    const appUrl = process.env.APP_URL ?? 'https://2anki.net';

    const sessionParams: StripeTypes.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/upload?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
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
          ga_session_id: input.gaSessionId,
          ...input.adClick,
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
