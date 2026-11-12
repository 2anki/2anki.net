import {
  CheckoutSessionReadError,
  DayPassCreditDecision,
  DayPassCreditEligibility,
} from './dayPassCredit';
import { formatDisplay } from './GetPassPricingUseCase';

export type DayPassCreditOfferView =
  | { eligible: false }
  | {
      eligible: true;
      amount: number;
      currency: string;
      display: string;
      semesterDisplay: string;
      dayPassDisplay: string;
      endsAt: string;
      semesterStartsAt: string | null;
    };

export class GetDayPassCreditOfferUseCase {
  constructor(private readonly eligibility: DayPassCreditEligibility) {}

  async execute(userId: number): Promise<DayPassCreditOfferView> {
    const decision = await this.decideQuietly(userId);
    if (!decision.eligible) {
      return { eligible: false };
    }
    return {
      eligible: true,
      amount: decision.amount,
      currency: decision.currency,
      display: formatDisplay(decision.amount, decision.currency),
      semesterDisplay: formatDisplay(
        decision.semesterAmount,
        decision.currency
      ),
      dayPassDisplay: formatDisplay(decision.dayPassAmount, decision.currency),
      endsAt: decision.offerEndsAt.toISOString(),
      semesterStartsAt: decision.semesterStartsAt?.toISOString() ?? null,
    };
  }

  // Showing the offer is optional; a Stripe hiccup reading the attached
  // checkout should hide it, not fail the account or upload page request.
  private async decideQuietly(userId: number): Promise<DayPassCreditDecision> {
    try {
      return await this.eligibility.decide(userId);
    } catch (error) {
      if (error instanceof CheckoutSessionReadError) {
        console.warn('checkout.day_pass_credit.session_read_failed', {
          user_id: userId,
        });
        return { eligible: false, reason: 'credit_used' };
      }
      throw error;
    }
  }
}
