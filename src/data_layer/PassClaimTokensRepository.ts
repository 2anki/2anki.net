import type { Knex } from 'knex';
import type PassClaimTokens from './public/PassClaimTokens';
import type { PassClaimTokensInitializer } from './public/PassClaimTokens';

export interface IPassClaimTokensRepository {
  insert(initializer: PassClaimTokensInitializer): Promise<PassClaimTokens>;
  findByTokenHash(tokenHash: string): Promise<PassClaimTokens | null>;
  markConsumed(id: number, trx: Knex.Transaction): Promise<void>;
  countRecentByUser(userId: number, since: Date): Promise<number>;
}

class PassClaimTokensRepository implements IPassClaimTokensRepository {
  constructor(private readonly database: Knex) {}

  async insert(
    initializer: PassClaimTokensInitializer
  ): Promise<PassClaimTokens> {
    const rows = await this.database('pass_claim_tokens')
      .insert(initializer)
      .returning('*');
    return rows[0];
  }

  async findByTokenHash(tokenHash: string): Promise<PassClaimTokens | null> {
    const row = await this.database('pass_claim_tokens')
      .where({ token_hash: tokenHash })
      .first();
    return row ?? null;
  }

  async markConsumed(id: number, trx: Knex.Transaction): Promise<void> {
    await trx('pass_claim_tokens')
      .where({ id })
      .update({ consumed_at: trx.fn.now() });
  }

  async countRecentByUser(userId: number, since: Date): Promise<number> {
    const result = await this.database('pass_claim_tokens')
      .where({ user_id: userId })
      .where('created_at', '>=', since)
      .count<{ count: string }>('* as count')
      .first();
    return Number(result?.count ?? 0);
  }
}

export default PassClaimTokensRepository;
