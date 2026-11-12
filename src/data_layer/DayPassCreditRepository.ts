import type { Knex } from 'knex';
import { whereNotRefunded } from './RefundedPaymentIntentsRepository';

export interface DayPassCredit {
  id: number;
  userId: number;
  dayPassPaymentIntentId: string;
  checkoutSessionId: string | null;
  redeemedAt: Date | null;
}

export interface RecentDayPass {
  paymentIntentId: string;
  expiresAt: Date;
}

export interface IDayPassCreditRepository {
  findRecentDayPass(
    userId: number,
    expiresAfter: Date
  ): Promise<RecentDayPass | null>;
  findByDayPass(dayPassPaymentIntentId: string): Promise<DayPassCredit | null>;
  claim(userId: number, dayPassPaymentIntentId: string): Promise<DayPassCredit>;
  attachSession(
    id: number,
    previousSessionId: string | null,
    sessionId: string
  ): Promise<boolean>;
  markRedeemedBySession(sessionId: string, redeemedAt: Date): Promise<boolean>;
}

interface DayPassCreditRow {
  id: number;
  user_id: number;
  day_pass_payment_intent_id: string;
  checkout_session_id: string | null;
  redeemed_at: Date | string | null;
}

const TABLE = 'day_pass_credits';
const PASSES = 'user_passes';

const toDate = (value: Date | string): Date =>
  value instanceof Date ? value : new Date(value);

const toCredit = (row: DayPassCreditRow): DayPassCredit => ({
  id: row.id,
  userId: row.user_id,
  dayPassPaymentIntentId: row.day_pass_payment_intent_id,
  checkoutSessionId: row.checkout_session_id,
  redeemedAt: row.redeemed_at == null ? null : toDate(row.redeemed_at),
});

export class DayPassCreditRepository implements IDayPassCreditRepository {
  constructor(private readonly database: Knex) {}

  buildFindRecentDayPassQuery(userId: number, expiresAfter: Date) {
    const query = this.database(PASSES)
      .select(`${PASSES}.stripe_payment_intent_id`, `${PASSES}.expires_at`)
      .where(`${PASSES}.user_id`, userId)
      .where(`${PASSES}.kind`, '24h')
      .where(`${PASSES}.stripe_payment_intent_id`, 'like', 'pi\\_%')
      .where(`${PASSES}.expires_at`, '>', expiresAfter)
      .whereNotExists(function signedOutPurchase() {
        this.select(1)
          .from('anonymous_passes')
          .whereRaw('??.?? = ??', [
            'anonymous_passes',
            'payment_intent_id',
            `${PASSES}.stripe_payment_intent_id`,
          ]);
      });
    return whereNotRefunded(query, `${PASSES}.stripe_payment_intent_id`)
      .orderBy(`${PASSES}.expires_at`, 'desc')
      .first();
  }

  async findRecentDayPass(
    userId: number,
    expiresAfter: Date
  ): Promise<RecentDayPass | null> {
    const row = (await this.buildFindRecentDayPassQuery(
      userId,
      expiresAfter
    )) as
      | { stripe_payment_intent_id: string; expires_at: Date | string }
      | undefined;
    if (row == null) {
      return null;
    }
    return {
      paymentIntentId: row.stripe_payment_intent_id,
      expiresAt: toDate(row.expires_at),
    };
  }

  async findByDayPass(
    dayPassPaymentIntentId: string
  ): Promise<DayPassCredit | null> {
    const row = await this.database<DayPassCreditRow>(TABLE)
      .where('day_pass_payment_intent_id', dayPassPaymentIntentId)
      .first();
    return row == null ? null : toCredit(row);
  }

  buildClaimQuery(userId: number, dayPassPaymentIntentId: string) {
    return this.database(TABLE)
      .insert({
        user_id: userId,
        day_pass_payment_intent_id: dayPassPaymentIntentId,
      })
      .onConflict('day_pass_payment_intent_id')
      .ignore();
  }

  async claim(
    userId: number,
    dayPassPaymentIntentId: string
  ): Promise<DayPassCredit> {
    await this.buildClaimQuery(userId, dayPassPaymentIntentId);
    const claimed = await this.findByDayPass(dayPassPaymentIntentId);
    if (claimed == null) {
      throw new Error('day_pass_credit.claim_missing_row');
    }
    return claimed;
  }

  buildAttachSessionQuery(
    id: number,
    previousSessionId: string | null,
    sessionId: string
  ) {
    const query = this.database(TABLE)
      .update({ checkout_session_id: sessionId })
      .where('id', id)
      .whereNull('redeemed_at');
    return previousSessionId == null
      ? query.whereNull('checkout_session_id')
      : query.where('checkout_session_id', previousSessionId);
  }

  async attachSession(
    id: number,
    previousSessionId: string | null,
    sessionId: string
  ): Promise<boolean> {
    const updated = await this.buildAttachSessionQuery(
      id,
      previousSessionId,
      sessionId
    );
    return Number(updated) > 0;
  }

  buildMarkRedeemedQuery(sessionId: string, redeemedAt: Date) {
    return this.database(TABLE)
      .update({ redeemed_at: redeemedAt })
      .where('checkout_session_id', sessionId)
      .whereNull('redeemed_at');
  }

  async markRedeemedBySession(
    sessionId: string,
    redeemedAt: Date
  ): Promise<boolean> {
    const updated = await this.buildMarkRedeemedQuery(sessionId, redeemedAt);
    return Number(updated) > 0;
  }
}

export class InMemoryDayPassCreditRepository implements IDayPassCreditRepository {
  private readonly credits: DayPassCredit[] = [];
  private readonly dayPasses: Array<RecentDayPass & { userId: number }> = [];
  private nextId = 1;

  seedDayPass(userId: number, paymentIntentId: string, expiresAt: Date): void {
    this.dayPasses.push({ userId, paymentIntentId, expiresAt });
  }

  async findRecentDayPass(
    userId: number,
    expiresAfter: Date
  ): Promise<RecentDayPass | null> {
    const latest = this.dayPasses
      .filter((pass) => pass.userId === userId && pass.expiresAt > expiresAfter)
      .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0];
    return latest == null
      ? null
      : {
          paymentIntentId: latest.paymentIntentId,
          expiresAt: latest.expiresAt,
        };
  }

  async findByDayPass(
    dayPassPaymentIntentId: string
  ): Promise<DayPassCredit | null> {
    const found = this.credits.find(
      (credit) => credit.dayPassPaymentIntentId === dayPassPaymentIntentId
    );
    return found == null ? null : { ...found };
  }

  async claim(
    userId: number,
    dayPassPaymentIntentId: string
  ): Promise<DayPassCredit> {
    const existing = await this.findByDayPass(dayPassPaymentIntentId);
    if (existing != null) {
      return existing;
    }
    const credit: DayPassCredit = {
      id: this.nextId++,
      userId,
      dayPassPaymentIntentId,
      checkoutSessionId: null,
      redeemedAt: null,
    };
    this.credits.push(credit);
    return { ...credit };
  }

  async attachSession(
    id: number,
    previousSessionId: string | null,
    sessionId: string
  ): Promise<boolean> {
    const credit = this.credits.find((row) => row.id === id);
    if (
      credit == null ||
      credit.redeemedAt != null ||
      credit.checkoutSessionId !== previousSessionId
    ) {
      return false;
    }
    credit.checkoutSessionId = sessionId;
    return true;
  }

  async markRedeemedBySession(
    sessionId: string,
    redeemedAt: Date
  ): Promise<boolean> {
    const credit = this.credits.find(
      (row) => row.checkoutSessionId === sessionId && row.redeemedAt == null
    );
    if (credit == null) {
      return false;
    }
    credit.redeemedAt = redeemedAt;
    return true;
  }
}

export default DayPassCreditRepository;
