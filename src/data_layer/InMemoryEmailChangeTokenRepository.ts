import type {
  EmailChangeToken,
  EmailChangeTokenInitializer,
  EmailChangeTokensId,
  IEmailChangeTokenRepository,
} from './EmailChangeTokenRepository';

class InMemoryEmailChangeTokenRepository implements IEmailChangeTokenRepository {
  private rows: EmailChangeToken[] = [];
  private nextId = 1;

  async insert(
    initializer: EmailChangeTokenInitializer
  ): Promise<EmailChangeToken> {
    const row: EmailChangeToken = {
      id: (initializer.id ?? this.nextId++) as EmailChangeTokensId,
      user_id: initializer.user_id,
      new_email: initializer.new_email,
      token_hash: initializer.token_hash,
      expires_at: initializer.expires_at,
      consumed_at: initializer.consumed_at ?? null,
      created_at: initializer.created_at ?? new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async findByTokenHash(tokenHash: string): Promise<EmailChangeToken | null> {
    return this.rows.find((row) => row.token_hash === tokenHash) ?? null;
  }

  async findLivePendingByUser(
    userId: number,
    now: Date
  ): Promise<EmailChangeToken | null> {
    const live = this.rows
      .filter(
        (row) =>
          Number(row.user_id) === userId &&
          row.consumed_at == null &&
          row.expires_at.getTime() > now.getTime()
      )
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    return live[0] ?? null;
  }

  async markConsumed(id: number): Promise<void> {
    const row = this.rows.find((candidate) => Number(candidate.id) === id);
    if (row != null) {
      row.consumed_at = new Date();
    }
  }

  async deleteLivePendingByUser(userId: number): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter(
      (row) => !(Number(row.user_id) === userId && row.consumed_at == null)
    );
    return before - this.rows.length;
  }

  async countRecentByUser(userId: number, since: Date): Promise<number> {
    return this.rows.filter(
      (row) =>
        Number(row.user_id) === userId &&
        row.created_at.getTime() >= since.getTime()
    ).length;
  }
}

export default InMemoryEmailChangeTokenRepository;
