import type StripeTypes from 'stripe';
import type {
  DayPassCredit,
  IDayPassCreditRepository,
  RecentDayPass,
} from '../../data_layer/DayPassCreditRepository';
import type { IUserPassRepository } from '../../data_layer/UserPassRepository';
import type {
  PricingService,
  ResolvedPassPrice,
} from '../../services/PricingService';
import { PASS_DURATION_MS } from '../passes/passDurations';
import { HeldEntitlements, resolvePurchaseBlock } from './resolvePurchaseBlock';

export const DAY_PASS_CREDIT_WINDOW_MS = 48 * 60 * 60 * 1000;
export const DAY_PASS_CREDIT_SURFACE = 'day_pass_credit';
const STRIPE_MINIMUM_CHARGE = 50;
const CHECKOUT_LONGEST_MS = 24 * 60 * 60 * 1000;
const CHECKOUT_SHORTEST_MS = 31 * 60 * 1000;

export type DayPassCreditRefusal =
  | 'plan_held'
  | 'no_recent_day_pass'
  | 'credit_used'
  | 'price_unavailable';

export interface DayPassCreditOffer {
  eligible: true;
  dayPassPaymentIntentId: string;
  endsAt: Date;
  checkoutExpiresAt: Date;
  semesterStartsAt: Date | null;
  amount: number;
  currency: string;
  semesterAmount: number;
  dayPassAmount: number;
  semesterProductId: string;
  credit: DayPassCredit | null;
  openSessionUrl: string | null;
}

export type DayPassCreditDecision =
  | DayPassCreditOffer
  | { eligible: false; reason: DayPassCreditRefusal };

export interface DayPassCreditEligibilityDeps {
  credits: Pick<
    IDayPassCreditRepository,
    'findRecentDayPass' | 'findByDayPass'
  >;
  passes: Pick<IUserPassRepository, 'findActivePasses'>;
  sessions: Pick<StripeTypes.Checkout.SessionResource, 'retrieve'>;
  pricing: Pick<PricingService, 'resolve'>;
  heldEntitlements: (userId: number) => Promise<HeldEntitlements>;
  now: () => Date;
}

type EarlierSession =
  | { status: 'none' }
  | { status: 'paid' }
  | { status: 'open'; url: string };

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

// A signed-in Day Pass starts when it is paid for and runs no later than a day
// from now, so its purchase time is its end minus one day. Claimed signed-out
// passes, Apple passes and passes stacked behind another one are filtered out
// by the repository window and by refusing any other running pass.
const creditEndsAt = (dayPass: RecentDayPass): Date =>
  new Date(
    dayPass.expiresAt.getTime() -
      PASS_DURATION_MS['24h'] +
      DAY_PASS_CREDIT_WINDOW_MS
  );

const isMissingSession = (error: unknown): boolean =>
  (error as { code?: string } | null)?.code === 'resource_missing';

const priceOf = (
  semester: ResolvedPassPrice,
  dayPass: ResolvedPassPrice
): Pick<
  DayPassCreditOffer,
  | 'amount'
  | 'currency'
  | 'semesterAmount'
  | 'dayPassAmount'
  | 'semesterProductId'
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

export class DayPassCreditEligibility {
  constructor(private readonly deps: DayPassCreditEligibilityDeps) {}

  async decide(userId: number): Promise<DayPassCreditDecision> {
    const now = this.deps.now();
    const dayPass = await this.deps.credits.findRecentDayPass(userId, {
      expiresAfter: new Date(
        now.getTime() + PASS_DURATION_MS['24h'] - DAY_PASS_CREDIT_WINDOW_MS
      ),
      expiresBy: new Date(now.getTime() + PASS_DURATION_MS['24h']),
    });
    if (dayPass == null) {
      return refuse('no_recent_day_pass');
    }
    const endsAt = creditEndsAt(dayPass);
    if (endsAt.getTime() - now.getTime() < CHECKOUT_SHORTEST_MS) {
      return refuse('no_recent_day_pass');
    }

    if (await this.holdsAnotherPlan(userId, now)) {
      return refuse('plan_held');
    }

    const credit = await this.deps.credits.findByDayPass(
      dayPass.paymentIntentId
    );
    if (credit?.redeemedAt != null) {
      return refuse('credit_used');
    }
    const earlier = await this.earlierSession(credit);
    if (earlier.status === 'paid') {
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
      checkoutExpiresAt: new Date(
        Math.min(endsAt.getTime(), now.getTime() + CHECKOUT_LONGEST_MS)
      ),
      semesterStartsAt: dayPass.expiresAt > now ? dayPass.expiresAt : null,
      ...price,
      credit,
      openSessionUrl: earlier.status === 'open' ? earlier.url : null,
    };
  }

  private async holdsAnotherPlan(userId: number, now: Date): Promise<boolean> {
    const held = await this.deps.heldEntitlements(userId);
    if (holdsBlockingPlan(held)) {
      return true;
    }
    const running = await this.deps.passes.findActivePasses(userId, now);
    return running.some((pass) => pass.kind !== '24h');
  }

  private async earlierSession(
    credit: DayPassCredit | null
  ): Promise<EarlierSession> {
    if (credit?.checkoutSessionId == null) {
      return { status: 'none' };
    }
    let session: StripeTypes.Checkout.Session;
    try {
      session = await this.deps.sessions.retrieve(credit.checkoutSessionId);
    } catch (error) {
      if (isMissingSession(error)) {
        return { status: 'none' };
      }
      throw error;
    }
    if (session.status === 'complete') {
      return { status: 'paid' };
    }
    if (session.status === 'open' && session.url != null) {
      return { status: 'open', url: session.url };
    }
    return { status: 'none' };
  }
}
