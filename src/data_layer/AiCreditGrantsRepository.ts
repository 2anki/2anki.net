import type { Knex } from 'knex';

export interface IAiCreditGrantsReader {
  sumActiveCredits(userId: number, now: Date): Promise<number>;
}

export interface AiCreditPackGrant {
  userId: number;
  amountCredits: number;
  expiresAt: Date;
  stripeSessionId: string;
}

export interface IAiCreditGrantsWriter {
  insertPackGrant(grant: AiCreditPackGrant): Promise<boolean>;
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
}

export default AiCreditGrantsRepository;
