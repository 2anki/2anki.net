import type { Knex } from 'knex';

export type PassKind = '24h' | '7d' | 'unlimited';

export interface UserPass {
  id: number;
  user_id: number;
  kind: PassKind;
  expires_at: Date;
  stripe_payment_intent_id: string;
}

export interface UserPassWindowRow {
  id: number;
  userId: number;
  kind: string;
  expiresAt: Date;
}

export interface IUserPassRepository {
  findActive(userId: number, now: Date): Promise<UserPass | null>;
  upsertWithExtension(
    userId: number,
    kind: PassKind,
    durationMs: number,
    stripePaymentIntentId: string,
    now: Date
  ): Promise<UserPass>;
  upsertWithAbsoluteExpiry(
    userId: number,
    kind: PassKind,
    expiresAt: Date,
    stripePaymentIntentId: string
  ): Promise<UserPass>;
}

interface UserPassRow {
  id: number;
  user_id: number;
  kind: string;
  expires_at: Date;
  stripe_payment_intent_id: string;
}

function toUserPass(row: UserPassRow): UserPass {
  return {
    id: row.id,
    user_id: row.user_id,
    kind: row.kind as PassKind,
    expires_at:
      row.expires_at instanceof Date
        ? row.expires_at
        : new Date(row.expires_at),
    stripe_payment_intent_id: row.stripe_payment_intent_id,
  };
}

export class UserPassRepository implements IUserPassRepository {
  private readonly table = 'user_passes';

  constructor(private readonly database: Knex) {}

  async findActive(userId: number, now: Date): Promise<UserPass | null> {
    const row = await this.database<UserPassRow>(this.table)
      .where('user_id', userId)
      .where('expires_at', '>', now)
      .orderBy('expires_at', 'desc')
      .first();
    return row ? toUserPass(row) : null;
  }

  async existsByPaymentIntentId(paymentIntentId: string): Promise<boolean> {
    const row = await this.database<UserPassRow>(this.table)
      .where('stripe_payment_intent_id', paymentIntentId)
      .first();
    return row != null;
  }

  async listActiveInWindow(
    since: Date,
    until: Date
  ): Promise<UserPassWindowRow[]> {
    const rows = await this.database<UserPassRow>(this.table)
      .select('id', 'user_id', 'kind', 'expires_at')
      .where('expires_at', '>=', since)
      .where('expires_at', '<=', until);
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      kind: row.kind,
      expiresAt:
        row.expires_at instanceof Date
          ? row.expires_at
          : new Date(row.expires_at),
    }));
  }

  async upsertWithExtension(
    userId: number,
    kind: PassKind,
    durationMs: number,
    stripePaymentIntentId: string,
    now: Date
  ): Promise<UserPass> {
    const existing = await this.database<UserPassRow>(this.table)
      .where('stripe_payment_intent_id', stripePaymentIntentId)
      .first();
    if (existing) {
      return toUserPass(existing);
    }

    const currentActive = await this.database<UserPassRow>(this.table)
      .where('user_id', userId)
      .where('expires_at', '>', now)
      .orderBy('expires_at', 'desc')
      .first();

    const base = currentActive ? currentActive.expires_at : now;
    const baseMs =
      base instanceof Date ? base.getTime() : new Date(base).getTime();
    const expiresAt = new Date(baseMs + durationMs);

    try {
      const [row] = await this.database<UserPassRow>(this.table)
        .insert({
          user_id: userId,
          kind,
          expires_at: expiresAt,
          stripe_payment_intent_id: stripePaymentIntentId,
        })
        .returning('*');
      return toUserPass(row);
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        const idempotent = await this.database<UserPassRow>(this.table)
          .where('stripe_payment_intent_id', stripePaymentIntentId)
          .first();
        if (idempotent) return toUserPass(idempotent);
      }
      throw err;
    }
  }

  async upsertWithAbsoluteExpiry(
    userId: number,
    kind: PassKind,
    expiresAt: Date,
    stripePaymentIntentId: string
  ): Promise<UserPass> {
    const existing = await this.database<UserPassRow>(this.table)
      .where('stripe_payment_intent_id', stripePaymentIntentId)
      .first();
    if (existing) {
      return toUserPass(existing);
    }

    try {
      const [row] = await this.database<UserPassRow>(this.table)
        .insert({
          user_id: userId,
          kind,
          expires_at: expiresAt,
          stripe_payment_intent_id: stripePaymentIntentId,
        })
        .returning('*');
      return toUserPass(row);
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        const idempotent = await this.database<UserPassRow>(this.table)
          .where('stripe_payment_intent_id', stripePaymentIntentId)
          .first();
        if (idempotent) return toUserPass(idempotent);
      }
      throw err;
    }
  }
}

export class InMemoryUserPassRepository implements IUserPassRepository {
  private readonly rows: UserPass[] = [];
  private nextId = 1;

  seed(row: Omit<UserPass, 'id'>): UserPass {
    const entry: UserPass = { id: this.nextId++, ...row };
    this.rows.push(entry);
    return entry;
  }

  async findActive(userId: number, now: Date): Promise<UserPass | null> {
    const active = this.rows
      .filter((r) => r.user_id === userId && r.expires_at > now)
      .sort((a, b) => b.expires_at.getTime() - a.expires_at.getTime());
    return active[0] ?? null;
  }

  async existsByPaymentIntentId(paymentIntentId: string): Promise<boolean> {
    return this.rows.some(
      (r) => r.stripe_payment_intent_id === paymentIntentId
    );
  }

  async upsertWithExtension(
    userId: number,
    kind: PassKind,
    durationMs: number,
    stripePaymentIntentId: string,
    now: Date
  ): Promise<UserPass> {
    const existing = this.rows.find(
      (r) => r.stripe_payment_intent_id === stripePaymentIntentId
    );
    if (existing) return existing;

    const currentActive = this.rows
      .filter((r) => r.user_id === userId && r.expires_at > now)
      .sort((a, b) => b.expires_at.getTime() - a.expires_at.getTime())[0];

    const base = currentActive ? currentActive.expires_at : now;
    const expiresAt = new Date(base.getTime() + durationMs);

    const entry: UserPass = {
      id: this.nextId++,
      user_id: userId,
      kind,
      expires_at: expiresAt,
      stripe_payment_intent_id: stripePaymentIntentId,
    };
    this.rows.push(entry);
    return entry;
  }

  async upsertWithAbsoluteExpiry(
    userId: number,
    kind: PassKind,
    expiresAt: Date,
    stripePaymentIntentId: string
  ): Promise<UserPass> {
    const existing = this.rows.find(
      (r) => r.stripe_payment_intent_id === stripePaymentIntentId
    );
    if (existing) return existing;

    const entry: UserPass = {
      id: this.nextId++,
      user_id: userId,
      kind,
      expires_at: expiresAt,
      stripe_payment_intent_id: stripePaymentIntentId,
    };
    this.rows.push(entry);
    return entry;
  }

  clear(): void {
    this.rows.length = 0;
    this.nextId = 1;
  }
}

export default UserPassRepository;
