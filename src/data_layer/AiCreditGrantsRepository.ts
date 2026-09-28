import type { Knex } from 'knex';

export interface AiCreditGrantWindow {
  windowStart: Date;
  windowEnd: Date;
}

export interface IAiCreditGrantsReader {
  sumActiveCredits(userId: number, now: Date): Promise<number>;
  activeGrantWindow(
    userId: number,
    now: Date
  ): Promise<AiCreditGrantWindow | null>;
}

export interface AiCreditPackGrant {
  userId: number;
  amountCredits: number;
  expiresAt: Date;
  stripeSessionId: string;
}

export interface AiCreditAppleGrant {
  userId: number;
  amountCredits: number;
  expiresAt: Date;
  appleTransactionId: string;
}

export interface IAiCreditGrantsWriter {
  insertPackGrant(grant: AiCreditPackGrant): Promise<boolean>;
  insertAppleGrant(grant: AiCreditAppleGrant): Promise<boolean>;
}

// The unique dedupe column is named for the Stripe session that created the
// table. An Apple consumable dedupes on its transaction id in the same column,
// prefixed so the two id spaces can never collide.
export function appleGrantDedupeKey(appleTransactionId: string): string {
  return `apple:${appleTransactionId}`;
}

export class AiCreditGrantsRepository
  implements IAiCreditGrantsReader, IAiCreditGrantsWriter
{
  private readonly table = 'ai_credit_grants';

  constructor(private readonly database: Knex) {}

  buildSumActiveCreditsQuery(userId: number, now: Date): Knex.QueryBuilder {
    return this.database(this.table)
      .where('user_id', userId)
      .where('expires_at', '>', now)
      .sum({ credits: 'amount_credits' });
  }

  async sumActiveCredits(userId: number, now: Date): Promise<number> {
    const row = (await this.buildSumActiveCreditsQuery(userId, now).first()) as
      | { credits: number | string | null }
      | undefined;
    return Number(row?.credits ?? 0);
  }

  buildActiveGrantWindowQuery(userId: number, now: Date): Knex.QueryBuilder {
    return this.database(this.table)
      .where('user_id', userId)
      .where('expires_at', '>', now)
      .min({ window_start: 'created_at' })
      .max({ window_end: 'expires_at' });
  }

  async activeGrantWindow(
    userId: number,
    now: Date
  ): Promise<AiCreditGrantWindow | null> {
    const row = (await this.buildActiveGrantWindowQuery(
      userId,
      now
    ).first()) as
      | { window_start: Date | string | null; window_end: Date | string | null }
      | undefined;
    if (row?.window_start == null || row.window_end == null) {
      return null;
    }
    return {
      windowStart: new Date(row.window_start),
      windowEnd: new Date(row.window_end),
    };
  }

  buildInsertPackGrantQuery(grant: AiCreditPackGrant): Knex.QueryBuilder {
    return this.database(this.table)
      .insert({
        user_id: grant.userId,
        source: 'pack',
        amount_credits: grant.amountCredits,
        expires_at: grant.expiresAt,
        stripe_session_id: grant.stripeSessionId,
      })
      .onConflict('stripe_session_id')
      .ignore()
      .returning('id');
  }

  async insertPackGrant(grant: AiCreditPackGrant): Promise<boolean> {
    const inserted = (await this.buildInsertPackGrantQuery(grant)) as unknown[];
    return inserted.length > 0;
  }

  buildInsertAppleGrantQuery(grant: AiCreditAppleGrant): Knex.QueryBuilder {
    return this.database(this.table)
      .insert({
        user_id: grant.userId,
        source: 'apple',
        amount_credits: grant.amountCredits,
        expires_at: grant.expiresAt,
        stripe_session_id: appleGrantDedupeKey(grant.appleTransactionId),
      })
      .onConflict('stripe_session_id')
      .ignore()
      .returning('id');
  }

  async insertAppleGrant(grant: AiCreditAppleGrant): Promise<boolean> {
    const inserted = (await this.buildInsertAppleGrantQuery(
      grant
    )) as unknown[];
    return inserted.length > 0;
  }
}

export interface InMemoryAiCreditGrant {
  userId: number;
  source: 'pack' | 'apple';
  amountCredits: number;
  expiresAt: Date;
  dedupeKey: string;
}

export class InMemoryAiCreditGrantsRepository implements IAiCreditGrantsWriter {
  readonly grants: InMemoryAiCreditGrant[] = [];

  async insertPackGrant(grant: AiCreditPackGrant): Promise<boolean> {
    return this.insert({
      userId: grant.userId,
      source: 'pack',
      amountCredits: grant.amountCredits,
      expiresAt: grant.expiresAt,
      dedupeKey: grant.stripeSessionId,
    });
  }

  async insertAppleGrant(grant: AiCreditAppleGrant): Promise<boolean> {
    return this.insert({
      userId: grant.userId,
      source: 'apple',
      amountCredits: grant.amountCredits,
      expiresAt: grant.expiresAt,
      dedupeKey: appleGrantDedupeKey(grant.appleTransactionId),
    });
  }

  private insert(grant: InMemoryAiCreditGrant): boolean {
    if (this.grants.some((g) => g.dedupeKey === grant.dedupeKey)) {
      return false;
    }
    this.grants.push(grant);
    return true;
  }
}

export default AiCreditGrantsRepository;
