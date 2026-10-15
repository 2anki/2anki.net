import type {
  AnonymousPass,
  AnonymousPassRepository,
} from '../../data_layer/AnonymousPassRepository';
import type {
  PassKind,
  UserPass,
  UserPassRepository,
} from '../../data_layer/UserPassRepository';
import type { EventsSink } from '../../services/events/EventsSink';

export type RefundUserPassRepository = Pick<
  UserPassRepository,
  'findByPaymentIntentId' | 'endByPaymentIntentId'
>;

export type RefundAnonymousPassRepository = Pick<
  AnonymousPassRepository,
  'findByPaymentIntentId' | 'endByPaymentIntentId'
>;

export interface RefundedCharge {
  paymentIntentId: string | null;
  refunded: boolean;
  amount: number;
  amountRefunded: number;
}

export type EndRefundedPassOutcome =
  | { status: 'no_payment_intent' }
  | { status: 'no_pass' }
  | { status: 'partial_refund'; kind: PassKind }
  | {
      status: 'ended';
      kind: PassKind;
      endedUserPasses: number;
      endedAnonymousPasses: number;
    }
  | { status: 'already_ended'; kind: PassKind };

export function isFullRefund(charge: RefundedCharge): boolean {
  if (charge.refunded) {
    return true;
  }
  return charge.amount > 0 && charge.amountRefunded >= charge.amount;
}

/**
 * Ends the pass bought with a refunded charge. Passes are keyed by the
 * charge's payment intent in both user_passes and anonymous_passes (a claimed
 * anonymous pass has a row in each). Only a full refund ends access; a
 * partial refund is recorded and leaves the pass running. Subscription
 * charges never match a pass row, so they fall through as `no_pass` —
 * subscription access is ended by customer.subscription.deleted instead.
 */
export class EndRefundedPassUseCase {
  constructor(
    private readonly userPassRepo: RefundUserPassRepository,
    private readonly anonPassRepo: RefundAnonymousPassRepository,
    private readonly eventsSink?: Pick<EventsSink, 'record'>
  ) {}

  async execute(
    charge: RefundedCharge,
    now: Date = new Date()
  ): Promise<EndRefundedPassOutcome> {
    const paymentIntentId = charge.paymentIntentId;
    if (paymentIntentId == null || paymentIntentId === '') {
      return { status: 'no_payment_intent' };
    }

    const userPass =
      await this.userPassRepo.findByPaymentIntentId(paymentIntentId);
    const anonPasses =
      await this.anonPassRepo.findByPaymentIntentId(paymentIntentId);
    if (userPass == null && anonPasses.length === 0) {
      return { status: 'no_pass' };
    }

    const kind = userPass?.kind ?? anonPasses[0].kind;
    const userId = resolveUserId(userPass, anonPasses);
    const full = isFullRefund(charge);

    if (!full) {
      this.record(userId, kind, false, false, now);
      return { status: 'partial_refund', kind };
    }

    const endedUserPasses = await this.userPassRepo.endByPaymentIntentId(
      paymentIntentId,
      now
    );
    const endedAnonymousPasses = await this.anonPassRepo.endByPaymentIntentId(
      paymentIntentId,
      now
    );
    const accessEnded =
      endedUserPasses.length > 0 || endedAnonymousPasses.length > 0;
    this.record(userId, kind, true, accessEnded, now);

    if (!accessEnded) {
      return { status: 'already_ended', kind };
    }
    return {
      status: 'ended',
      kind,
      endedUserPasses: endedUserPasses.length,
      endedAnonymousPasses: endedAnonymousPasses.length,
    };
  }

  private record(
    userId: number | null,
    kind: PassKind,
    full: boolean,
    accessEnded: boolean,
    now: Date
  ): void {
    this.eventsSink?.record({
      name: 'pass_refunded',
      user_id: userId,
      props: { kind, full, access_ended: accessEnded },
      created_at: now,
    });
  }
}

function resolveUserId(
  userPass: UserPass | null,
  anonPasses: AnonymousPass[]
): number | null {
  if (userPass != null) {
    return userPass.user_id;
  }
  const claimed = anonPasses.find((pass) => pass.claimed_by_user_id != null);
  return claimed?.claimed_by_user_id ?? null;
}
