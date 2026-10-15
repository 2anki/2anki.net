import type { Knex } from 'knex';

export const REFUNDED_PAYMENT_INTENTS_TABLE = 'refunded_payment_intents';

/**
 * Restricts an update to rows whose payment intent has NOT been refunded.
 * Used on the statement that writes access (claim, activation) so the refund
 * check and the write happen atomically.
 */
export function whereNotRefunded(
  query: Knex.QueryBuilder,
  paymentIntentColumn: string
): Knex.QueryBuilder {
  return query.whereNotExists(function refunded() {
    this.select(1)
      .from(REFUNDED_PAYMENT_INTENTS_TABLE)
      .whereRaw('??.?? = ??', [
        REFUNDED_PAYMENT_INTENTS_TABLE,
        'payment_intent_id',
        paymentIntentColumn,
      ]);
  });
}

/**
 * Value for an expires_at column on insert: the intended expiry, or already
 * ended (now) when the payment intent was refunded first. Evaluated inside
 * the INSERT itself, so a refund that arrives before checkout.session.completed
 * produces an ended pass instead of a running one.
 */
export function refundAwareExpiry(
  database: Knex,
  paymentIntentId: string,
  expiresAt: Date
): Knex.Raw {
  return database.raw(
    `case when exists (select 1 from "${REFUNDED_PAYMENT_INTENTS_TABLE}" where "payment_intent_id" = ?) then least(?::timestamptz, now()) else ?::timestamptz end`,
    [paymentIntentId, expiresAt, expiresAt]
  );
}

export interface IRefundedPaymentIntentsRepository {
  markRefunded(paymentIntentId: string, refundedAt: Date): Promise<void>;
  isRefunded(paymentIntentId: string): Promise<boolean>;
}

export class RefundedPaymentIntentsRepository implements IRefundedPaymentIntentsRepository {
  constructor(private readonly database: Knex) {}

  buildMarkRefundedQuery(paymentIntentId: string, refundedAt: Date) {
    return this.database(REFUNDED_PAYMENT_INTENTS_TABLE)
      .insert({ payment_intent_id: paymentIntentId, refunded_at: refundedAt })
      .onConflict('payment_intent_id')
      .ignore();
  }

  async markRefunded(paymentIntentId: string, refundedAt: Date): Promise<void> {
    await this.buildMarkRefundedQuery(paymentIntentId, refundedAt);
  }

  async isRefunded(paymentIntentId: string): Promise<boolean> {
    const row = await this.database(REFUNDED_PAYMENT_INTENTS_TABLE)
      .where('payment_intent_id', paymentIntentId)
      .first();
    return row != null;
  }
}

export class InMemoryRefundedPaymentIntentsRepository implements IRefundedPaymentIntentsRepository {
  readonly refunded = new Set<string>();

  async markRefunded(paymentIntentId: string): Promise<void> {
    this.refunded.add(paymentIntentId);
  }

  async isRefunded(paymentIntentId: string): Promise<boolean> {
    return this.refunded.has(paymentIntentId);
  }

  clear(): void {
    this.refunded.clear();
  }
}

export default RefundedPaymentIntentsRepository;
