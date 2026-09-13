import type { Knex } from 'knex';

export interface IAiCreditGrantsReader {
  sumActiveCredits(userId: number, now: Date): Promise<number>;
}

export class AiCreditGrantsRepository implements IAiCreditGrantsReader {
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
}

export default AiCreditGrantsRepository;
