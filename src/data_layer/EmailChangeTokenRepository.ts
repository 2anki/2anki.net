import type { Knex } from 'knex';
import type { UsersId } from './public/Users';

export type EmailChangeTokensId = number & {
  __brand: 'public.email_change_tokens';
};

export interface EmailChangeToken {
  id: EmailChangeTokensId;
  user_id: UsersId;
  new_email: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
}

export interface EmailChangeTokenInitializer {
  id?: EmailChangeTokensId;
  user_id: UsersId;
  new_email: string;
  token_hash: string;
  expires_at: Date;
  consumed_at?: Date | null;
  created_at?: Date;
}

export interface IEmailChangeTokenRepository {
  insert(initializer: EmailChangeTokenInitializer): Promise<EmailChangeToken>;
  findByTokenHash(tokenHash: string): Promise<EmailChangeToken | null>;
  findLivePendingByUser(
    userId: number,
    now: Date
  ): Promise<EmailChangeToken | null>;
  markConsumed(id: number, trx: Knex.Transaction): Promise<void>;
  expireLivePendingByUser(userId: number, now: Date): Promise<number>;
  countRecentByUser(userId: number, since: Date): Promise<number>;
}

class EmailChangeTokenRepository implements IEmailChangeTokenRepository {
  constructor(private readonly database: Knex) {}

  async insert(
    initializer: EmailChangeTokenInitializer
  ): Promise<EmailChangeToken> {
    const rows = await this.database('email_change_tokens')
      .insert(initializer)
      .returning('*');
    return rows[0];
  }

  async findByTokenHash(tokenHash: string): Promise<EmailChangeToken | null> {
    const row = await this.database('email_change_tokens')
      .where({ token_hash: tokenHash })
      .first();
    return row ?? null;
  }

  async findLivePendingByUser(
    userId: number,
    now: Date
  ): Promise<EmailChangeToken | null> {
    const row = await this.database('email_change_tokens')
      .where({ user_id: userId })
      .whereNull('consumed_at')
      .where('expires_at', '>', now)
      .orderBy('created_at', 'desc')
      .first();
    return row ?? null;
  }

  async markConsumed(id: number, trx: Knex.Transaction): Promise<void> {
    await trx('email_change_tokens')
      .where({ id })
      .update({ consumed_at: trx.fn.now() });
  }

  async expireLivePendingByUser(userId: number, now: Date): Promise<number> {
    return this.database('email_change_tokens')
      .where({ user_id: userId })
      .whereNull('consumed_at')
      .where('expires_at', '>', now)
      .update({ expires_at: now });
  }

  async countRecentByUser(userId: number, since: Date): Promise<number> {
    const result = await this.database('email_change_tokens')
      .where({ user_id: userId })
      .where('created_at', '>=', since)
      .count<{ count: string }>('* as count')
      .first();
    return Number(result?.count ?? 0);
  }
}

export default EmailChangeTokenRepository;
