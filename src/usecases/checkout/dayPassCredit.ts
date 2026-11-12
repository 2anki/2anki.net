import type {
  DayPassCredit,
  IDayPassCreditRepository,
  RecentDayPass,
} from '../../data_layer/DayPassCreditRepository';
import type {
  PricingService,
  ResolvedPassPrice,
} from '../../services/PricingService';
import { PASS_DURATION_MS } from '../passes/passDurations';
import { HeldEntitlements, resolvePurchaseBlock } from './resolvePurchaseBlock';

export const DAY_PASS_CREDIT_WINDOW_MS = 48 * 60 * 60 * 1000;
export const DAY_PASS_CREDIT_SURFACE = 'day_pass_credit';
const STRIPE_MINIMUM_CHARGE = 50;

export type DayPassCreditRefusal =
  | 'plan_held'
  | 'no_recent_day_pass'
  | 'credit_used'
  | 'price_unavailable';

export interface DayPassCreditOffer {
  eligible: true;
  dayPassPaymentIntentId: string;
  endsAt: Date;
  amount: number;
  currency: string;
  semesterAmount: number;
  dayPassAmount: number;
  semesterProductId: string;
}

export type DayPassCreditDecision =
  | DayPassCreditOffer
  | { eligible: false; reason: DayPassCreditRefusal };

export interface DayPassCreditEligibilityDeps {
  credits: Pick<
    IDayPassCreditRepository,
    'findRecentDayPass' | 'findByDayPass'
  >;
  pricing: Pick<PricingService, 'resolve'>;
  heldEntitlements: (userId: number) => Promise<HeldEntitlements>;
  now: () => Date;
}

const refuse = (reason: DayPassCreditRefusal): DayPassCreditDecision => ({
  eligible: false,
  reason,
});

// A Day Pass holder is the one pass buyer the duplicate-purchase rule lets
// through: the credit exists to move them up while their pass still runs.
const holdsBlockingPlan = (held: HeldEntitlements): boolean => {
  const block = resolvePurchaseBlock('pass', held);
  if (block == null) {
    return false;
  }
  return !(block.code === 'pass_still_active' && held.activePassKind === '24h');
};

// A Day Pass bought signed in starts when it is paid for, so its purchase time
// is its end minus one day. Claimed signed-out passes, which start at claim
// time, and Apple passes, which stack, are filtered out by the repository.
const creditEndsAt = (dayPass: RecentDayPass): Date =>
  new Date(
    dayPass.expiresAt.getTime() -
      PASS_DURATION_MS['24h'] +
      DAY_PASS_CREDIT_WINDOW_MS
  );

const priceOf = (
  semester: ResolvedPassPrice,
  dayPass: ResolvedPassPrice
): Omit<
  DayPassCreditOffer,
  'eligible' | 'dayPassPaymentIntentId' | 'endsAt'
> | null => {
  if (
    semester.amount == null ||
    semester.currency == null ||
    semester.productId == null ||
    dayPass.amount == null ||
    dayPass.currency == null ||
    semester.currency.toLowerCase() !== dayPass.currency.toLowerCase()
  ) {
    return null;
  }
  const amount = semester.amount - dayPass.amount;
  if (amount < STRIPE_MINIMUM_CHARGE) {
    return null;
  }
  return {
    amount,
    currency: semester.currency.toLowerCase(),
    semesterAmount: semester.amount,
    dayPassAmount: dayPass.amount,
    semesterProductId: semester.productId,
  };
};

const isRedeemed = (credit: DayPassCredit | null): boolean =>
  credit?.redeemedAt != null;

export class DayPassCreditEligibility {
  constructor(private readonly deps: DayPassCreditEligibilityDeps) {}

  async decide(userId: number): Promise<DayPassCreditDecision> {
    const now = this.deps.now();
    const held = await this.deps.heldEntitlements(userId);
    if (holdsBlockingPlan(held)) {
      return refuse('plan_held');
    }

    const earliestReachableExpiry = new Date(
      now.getTime() + PASS_DURATION_MS['24h'] - DAY_PASS_CREDIT_WINDOW_MS
    );
    const dayPass = await this.deps.credits.findRecentDayPass(
      userId,
      earliestReachableExpiry
    );
    if (dayPass == null) {
      return refuse('no_recent_day_pass');
    }
    const endsAt = creditEndsAt(dayPass);
    if (endsAt <= now) {
      return refuse('no_recent_day_pass');
    }

    const credit = await this.deps.credits.findByDayPass(
      dayPass.paymentIntentId
    );
    if (isRedeemed(credit)) {
      return refuse('credit_used');
    }

    const [semester, day] = await Promise.all([
      this.deps.pricing.resolve('120d'),
      this.deps.pricing.resolve('24h'),
    ]);
    const price = priceOf(semester, day);
    if (price == null) {
      console.warn('checkout.day_pass_credit.price_unavailable', {
        semester_source: semester.source,
        day_pass_source: day.source,
      });
      return refuse('price_unavailable');
    }

    return {
      eligible: true,
      dayPassPaymentIntentId: dayPass.paymentIntentId,
      endsAt,
      ...price,
    };
  }
}
