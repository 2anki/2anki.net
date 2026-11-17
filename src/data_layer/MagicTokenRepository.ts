import type { Knex } from 'knex';

import type MagicTokens from './public/MagicTokens';

export type MagicTokenPurpose = 'login' | 'password_reset' | 'verify_email';

const SIGN_IN_PURPOSES: MagicTokenPurpose[] = ['login', 'password_reset'];

export interface MagicTokenRecord {
  token: string;
  owner: number;
  purpose: MagicTokenPurpose;
  created_at: Date;
  expires_at: Date;
  used_at: Date | null;
}

export interface IMagicTokenRepository {
  create(
    token: string,
    owner: number,
    purpose: MagicTokenPurpose,
    expiresAt: Date
  ): Promise<void>;
  findValidToken(token: string): Promise<MagicTokenRecord | null>;
  findByToken(token: string): Promise<MagicTokenRecord | null>;
  consumeValidToken(token: string): Promise<MagicTokenRecord | null>;
  markUsed(token: string): Promise<void>;
  countRecentByOwner(owner: number, since: Date): Promise<number>;
  deleteExpired(): Promise<number>;
}

const now = () => new Date();

function toRecord(row: MagicTokens | undefined): MagicTokenRecord | null {
  if (row == null) {
    return null;
  }
  return {
    token: row.token,
    owner: row.owner,
    purpose: row.purpose as MagicTokenPurpose,
    created_at: row.created_at,
    expires_at: row.expires_at,
    used_at: row.used_at,
  };
}

export class MagicTokenRepository implements IMagicTokenRepository {
  private readonly table = 'magic_tokens';

  constructor(private readonly database: Knex) {}

  async create(
    token: string,
    owner: number,
    purpose: MagicTokenPurpose,
    expiresAt: Date
  ): Promise<void> {
    await this.database(this.table).insert({
      token,
      owner,
      purpose,
      expires_at: expiresAt,
    });
  }

  async findValidToken(token: string): Promise<MagicTokenRecord | null> {
    const row: MagicTokens | undefined = await this.database(this.table)
      .where({ token })
      .whereNull('used_at')
      .where('expires_at', '>', now())
      .first();
    return toRecord(row);
  }

  async findByToken(token: string): Promise<MagicTokenRecord | null> {
    const row: MagicTokens | undefined = await this.database(this.table)
      .where({ token })
      .first();
    return toRecord(row);
  }

  consumeQuery(token: string, at: Date = now()) {
    return this.database(this.table)
      .where({ token })
      .whereNull('used_at')
      .where('expires_at', '>', at)
      .whereIn('purpose', SIGN_IN_PURPOSES)
      .update({ used_at: at });
  }

  async consumeValidToken(token: string): Promise<MagicTokenRecord | null> {
    const spent = await this.consumeQuery(token);
    if (spent !== 1) {
      return null;
    }
    return this.findByToken(token);
  }

  async markUsed(token: string): Promise<void> {
    await this.database(this.table)
      .where({ token })
      .update({ used_at: this.database.fn.now() });
  }

  async countRecentByOwner(owner: number, since: Date): Promise<number> {
    const result = await this.database(this.table)
      .where({ owner })
      .where('created_at', '>=', since)
      .count<{ count: string | number }[]>('* as count')
      .first();
    return Number(result?.count ?? 0);
  }

  async deleteExpired(): Promise<number> {
    return this.database(this.table)
      .where('expires_at', '<=', this.database.fn.now())
      .del();
  }
}

export class InMemoryMagicTokenRepository implements IMagicTokenRepository {
  private readonly rows: Array<{
    token: string;
    owner: number;
    purpose: MagicTokenPurpose;
    created_at: Date;
    expires_at: Date;
    used_at: Date | null;
  }> = [];

  private now: Date = new Date();

  setNow(date: Date): void {
    this.now = date;
  }

  async create(
    token: string,
    owner: number,
    purpose: MagicTokenPurpose,
    expiresAt: Date
  ): Promise<void> {
    this.rows.push({
      token,
      owner,
      purpose,
      created_at: new Date(this.now),
      expires_at: expiresAt,
      used_at: null,
    });
  }

  async findValidToken(token: string): Promise<MagicTokenRecord | null> {
    const row = this.rows.find(
      (r) => r.token === token && r.used_at == null && r.expires_at > this.now
    );
    if (row == null) {
      return null;
    }
    return { ...row };
  }

  async findByToken(token: string): Promise<MagicTokenRecord | null> {
    const row = this.rows.find((r) => r.token === token);
    return row == null ? null : { ...row };
  }

  async consumeValidToken(token: string): Promise<MagicTokenRecord | null> {
    const row = this.rows.find(
      (r) =>
        r.token === token &&
        r.used_at == null &&
        r.expires_at > this.now &&
        SIGN_IN_PURPOSES.includes(r.purpose)
    );
    if (row == null) {
      return null;
    }
    row.used_at = new Date(this.now);
    return { ...row };
  }

  async markUsed(token: string): Promise<void> {
    const row = this.rows.find((r) => r.token === token);
    if (row != null) {
      row.used_at = new Date(this.now);
    }
  }

  async countRecentByOwner(owner: number, since: Date): Promise<number> {
    return this.rows.filter((r) => r.owner === owner && r.created_at >= since)
      .length;
  }

  async deleteExpired(): Promise<number> {
    const before = this.rows.length;
    const kept = this.rows.filter((r) => r.expires_at > this.now);
    this.rows.length = 0;
    this.rows.push(...kept);
    return before - this.rows.length;
  }

  clear(): void {
    this.rows.length = 0;
  }
}
