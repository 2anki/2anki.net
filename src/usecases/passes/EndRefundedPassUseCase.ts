import type {
  AnonymousPass,
  AnonymousPassRepository,
} from '../../data_layer/AnonymousPassRepository';
import type {
  PassKind,
  UserPass,
  UserPassRepository,
} from '../../data_layer/UserPassRepository';
import type { IRefundedPaymentIntentsRepository } from '../../data_layer/RefundedPaymentIntentsRepository';
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

// Stripe's amount_refunded is cumulative across every refund on the charge,
// so a partial refund followed by another that covers the rest is full here.
export function isFullRefund(charge: RefundedCharge): boolean {
  if (charge.refunded) {
    return true;
  }
  return charge.amount > 0 && charge.amountRefunded >= charge.amount;
}

/**
 * Ends the pass bought with a refunded charge. Only reached from the Stripe
 * webhook after signature verification. Passes are keyed by the charge's
 * payment intent in both user_passes and anonymous_passes (a claimed
 * anonymous pass has a row in each), so a refund can only end the pass paid
 * for by that charge. Only a full refund ends access; a partial refund is
 * recorded and leaves the pass running.
 *
 * A full refund is first recorded in refunded_payment_intents — even when no
 * pass exists yet — so a checkout.session.completed that Stripe delivers
 * after the refund grants an already-ended pass, and a claim or activation
 * racing this handler is refused in the same statement.
 *
 * Subscription charges never match a pass row, so they end as `no_pass` and
 * subscription access is left to customer.subscription.deleted.
 */
export class EndRefundedPassUseCase {
  constructor(
    private readonly userPassRepo: RefundUserPassRepository,
    private readonly anonPassRepo: RefundAnonymousPassRepository,
    private readonly refundedIntentsRepo: Pick<
      IRefundedPaymentIntentsRepository,
      'markRefunded'
    >,
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

    const full = isFullRefund(charge);
    if (full) {
      await this.refundedIntentsRepo.markRefunded(paymentIntentId, now);
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
