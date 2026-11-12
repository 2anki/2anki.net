import type StripeTypes from 'stripe';
import type { IDayPassCreditRepository } from '../../data_layer/DayPassCreditRepository';
import type { AdClickAttribution } from '../../lib/attribution/adClick';
import { anonIdConsentMetadata, optionalMetadata } from './checkoutMetadata';
import { createCheckoutSession } from './createCheckoutSession';
import {
  DAY_PASS_CREDIT_SURFACE,
  DayPassCreditEligibility,
  DayPassCreditOffer,
  DayPassCreditRefusal,
} from './dayPassCredit';
import {
  CheckoutCustomerRefresher,
  recoverWith,
} from './StaleCheckoutCustomerRefresher';

export type DayPassCreditCheckoutRefusal =
  | DayPassCreditRefusal
  | 'checkout_open';

export type DayPassCreditCheckoutResult =
  | { status: 'session'; url: string }
  | { status: 'refused'; reason: DayPassCreditCheckoutRefusal };

export interface DayPassCreditCheckoutInput {
  userId: number;
  userEmail?: string;
  stripeCustomerId?: string | null;
  anonId?: string;
  anonIdTrackingAllowed?: boolean;
  gaClientId?: string;
  gaSessionId?: string;
  adClick?: AdClickAttribution;
}

const refused = (
  reason: DayPassCreditCheckoutRefusal
): DayPassCreditCheckoutResult => ({ status: 'refused', reason });

export class CreateDayPassCreditCheckoutUseCase {
  constructor(
    private readonly stripe: Pick<StripeTypes, 'checkout'>,
    private readonly eligibility: DayPassCreditEligibility,
    private readonly credits: Pick<
      IDayPassCreditRepository,
      'claim' | 'attachSession'
    >,
    private readonly refresher?: CheckoutCustomerRefresher
  ) {}

  async execute(
    input: DayPassCreditCheckoutInput
  ): Promise<DayPassCreditCheckoutResult> {
    const decision = await this.eligibility.decide(input.userId);
    if (!decision.eligible) {
      return refused(decision.reason);
    }

    if (decision.openSessionUrl != null) {
      return { status: 'session', url: decision.openSessionUrl };
    }

    const credit = await this.credits.claim(
      input.userId,
      decision.dayPassPaymentIntentId
    );
    if (credit.userId !== input.userId || credit.redeemedAt != null) {
      return refused('credit_used');
    }
    const checkedSessionId = decision.credit?.checkoutSessionId ?? null;
    if (credit.checkoutSessionId !== checkedSessionId) {
      return refused('checkout_open');
    }

    const session = await createCheckoutSession(
      this.stripe,
      this.sessionParams(input, decision),
      recoverWith(this.refresher, input.userId, input.userEmail)
    );

    const attached = await this.credits.attachSession(
      credit.id,
      credit.checkoutSessionId,
      session.id
    );
    if (!attached) {
      await this.expireQuietly(session.id);
      return refused('checkout_open');
    }

    console.info('checkout.day_pass_credit.session_created', {
      user_id: input.userId,
      amount: decision.amount,
      currency: decision.currency,
    });
    return { status: 'session', url: session.url! };
  }

  private async expireQuietly(sessionId: string): Promise<void> {
    try {
      await this.stripe.checkout.sessions.expire(sessionId);
    } catch (error) {
      console.error('checkout.day_pass_credit.expire_failed', {
        error_code: (error as { code?: string }).code,
      });
    }
  }

  private sessionParams(
    input: DayPassCreditCheckoutInput,
    offer: DayPassCreditOffer
  ): StripeTypes.Checkout.SessionCreateParams {
    const appUrl = process.env.APP_URL ?? 'https://2anki.net';
    const metadata: Record<string, string> = {
      pass_kind: '120d',
      user_id: String(input.userId),
      surface: DAY_PASS_CREDIT_SURFACE,
      day_pass_credit: '1',
      ...optionalMetadata({
        anon_id: input.anonId,
        ga_client_id: input.gaClientId,
        ga_session_id: input.gaSessionId,
        ...input.adClick,
      }),
      ...anonIdConsentMetadata(input.anonIdTrackingAllowed === true),
    };

    return {
      mode: 'payment',
      invoice_creation: { enabled: true },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: offer.currency,
            unit_amount: offer.amount,
            product: offer.semesterProductId,
          },
        },
      ],
      success_url: `${appUrl}/upload?from=pass&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/account`,
      expires_at: Math.floor(offer.checkoutExpiresAt.getTime() / 1000),
      customer_email:
        input.stripeCustomerId == null ? input.userEmail : undefined,
      customer: input.stripeCustomerId ?? undefined,
      metadata,
    };
  }
}
