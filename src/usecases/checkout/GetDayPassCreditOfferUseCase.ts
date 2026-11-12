import { DayPassCreditEligibility } from './dayPassCredit';
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
    const decision = await this.eligibility.decide(userId);
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
      endsAt: decision.endsAt.toISOString(),
      semesterStartsAt: decision.semesterStartsAt?.toISOString() ?? null,
    };
  }
}
