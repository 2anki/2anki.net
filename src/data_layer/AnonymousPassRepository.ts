import type { Knex } from 'knex';
import type { PassKind } from './UserPassRepository';

export interface AnonymousPass {
  id: number;
  stripe_session_id: string;
  kind: PassKind;
  expires_at: Date;
  payment_intent_id: string;
  claimed_by_user_id: number | null;
  buyer_email_hash: string | null;
}

export interface IAnonymousPassRepository {
  findBySessionId(stripeSessionId: string): Promise<AnonymousPass | null>;
  findActive(stripeSessionId: string, now: Date): Promise<AnonymousPass | null>;
  insert(params: {
    stripeSessionId: string;
    kind: PassKind;
    expiresAt: Date;
    paymentIntentId: string;
    buyerEmailHash?: string | null;
  }): Promise<AnonymousPass>;
  findById(id: number): Promise<AnonymousPass | null>;
  findUnclaimedByBuyerEmailHash(
    buyerEmailHash: string,
    now: Date
  ): Promise<AnonymousPass[]>;
  findUnclaimedWithoutEmailHash(now: Date): Promise<AnonymousPass[]>;
  setBuyerEmailHash(id: number, buyerEmailHash: string): Promise<void>;
  claim(id: number, userId: number): Promise<boolean>;
  unclaim(id: number): Promise<void>;
}

interface AnonymousPassRow {
  id: number;
  stripe_session_id: string;
  kind: string;
  expires_at: Date;
  payment_intent_id: string;
  claimed_by_user_id: number | null;
  buyer_email_hash: string | null;
}

function toAnonymousPass(row: AnonymousPassRow): AnonymousPass {
  return {
    id: row.id,
    stripe_session_id: row.stripe_session_id,
    kind: row.kind as PassKind,
    expires_at:
      row.expires_at instanceof Date
        ? row.expires_at
        : new Date(row.expires_at),
    payment_intent_id: row.payment_intent_id,
    claimed_by_user_id: row.claimed_by_user_id ?? null,
    buyer_email_hash: row.buyer_email_hash ?? null,
  };
}

export class AnonymousPassRepository implements IAnonymousPassRepository {
  private readonly table = 'anonymous_passes';

  constructor(private readonly database: Knex) {}

  async findBySessionId(
    stripeSessionId: string
  ): Promise<AnonymousPass | null> {
    const row = await this.database<AnonymousPassRow>(this.table)
      .where('stripe_session_id', stripeSessionId)
      .first();
    return row ? toAnonymousPass(row) : null;
  }

  async findActive(
    stripeSessionId: string,
    now: Date
  ): Promise<AnonymousPass | null> {
    const row = await this.database<AnonymousPassRow>(this.table)
      .where('stripe_session_id', stripeSessionId)
      .where('expires_at', '>', now)
      .whereNull('claimed_by_user_id')
      .first();
    return row ? toAnonymousPass(row) : null;
  }

  async insert(params: {
    stripeSessionId: string;
    kind: PassKind;
    expiresAt: Date;
    paymentIntentId: string;
    buyerEmailHash?: string | null;
  }): Promise<AnonymousPass> {
    const existing = await this.database<AnonymousPassRow>(this.table)
      .where('stripe_session_id', params.stripeSessionId)
      .first();
    if (existing) {
      return toAnonymousPass(existing);
    }

    try {
      const [row] = await this.database<AnonymousPassRow>(this.table)
        .insert({
          stripe_session_id: params.stripeSessionId,
          kind: params.kind,
          expires_at: params.expiresAt,
          payment_intent_id: params.paymentIntentId,
          buyer_email_hash: params.buyerEmailHash ?? null,
        })
        .returning('*');
      return toAnonymousPass(row);
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === '23505') {
        const idempotent = await this.database<AnonymousPassRow>(this.table)
          .where('stripe_session_id', params.stripeSessionId)
          .first();
        if (idempotent) return toAnonymousPass(idempotent);
      }
      throw err;
    }
  }

  async findUnclaimedByBuyerEmailHash(
    buyerEmailHash: string,
    now: Date
  ): Promise<AnonymousPass[]> {
    const rows = await this.database<AnonymousPassRow>(this.table)
      .where('buyer_email_hash', buyerEmailHash)
      .whereNull('claimed_by_user_id')
      .where('expires_at', '>', now)
      .orderBy('expires_at', 'desc');
    return rows.map(toAnonymousPass);
  }

  async findUnclaimedWithoutEmailHash(now: Date): Promise<AnonymousPass[]> {
    const rows = await this.database<AnonymousPassRow>(this.table)
      .whereNull('buyer_email_hash')
      .whereNull('claimed_by_user_id')
      .where('expires_at', '>', now)
      .orderBy('id', 'asc');
    return rows.map(toAnonymousPass);
  }

  async setBuyerEmailHash(id: number, buyerEmailHash: string): Promise<void> {
    await this.database(this.table)
      .where({ id })
      .whereNull('buyer_email_hash')
      .update({ buyer_email_hash: buyerEmailHash });
  }

  async claim(id: number, userId: number): Promise<boolean> {
    const updated = await this.database(this.table)
      .where({ id })
      .whereNull('claimed_by_user_id')
      .update({ claimed_by_user_id: userId });
    return updated === 1;
  }

  async unclaim(id: number): Promise<void> {
    await this.database(this.table)
      .where({ id })
      .update({ claimed_by_user_id: null });
  }

  async findById(id: number): Promise<AnonymousPass | null> {
    const row = await this.database<AnonymousPassRow>(this.table)
      .where({ id })
      .first();
    return row ? toAnonymousPass(row) : null;
  }
}

export class InMemoryAnonymousPassRepository implements IAnonymousPassRepository {
  private readonly rows: AnonymousPass[] = [];
  private nextId = 1;

  async findBySessionId(
    stripeSessionId: string
  ): Promise<AnonymousPass | null> {
    return (
      this.rows.find((r) => r.stripe_session_id === stripeSessionId) ?? null
    );
  }

  async findActive(
    stripeSessionId: string,
    now: Date
  ): Promise<AnonymousPass | null> {
    const row = this.rows.find(
      (r) =>
        r.stripe_session_id === stripeSessionId &&
        r.expires_at > now &&
        r.claimed_by_user_id == null
    );
    return row ?? null;
  }

  async insert(params: {
    stripeSessionId: string;
    kind: PassKind;
    expiresAt: Date;
    paymentIntentId: string;
    buyerEmailHash?: string | null;
  }): Promise<AnonymousPass> {
    const existing = this.rows.find(
      (r) => r.stripe_session_id === params.stripeSessionId
    );
    if (existing) return existing;

    const entry: AnonymousPass = {
      id: this.nextId++,
      stripe_session_id: params.stripeSessionId,
      kind: params.kind,
      expires_at: params.expiresAt,
      payment_intent_id: params.paymentIntentId,
      claimed_by_user_id: null,
      buyer_email_hash: params.buyerEmailHash ?? null,
    };
    this.rows.push(entry);
    return entry;
  }

  async findUnclaimedByBuyerEmailHash(
    buyerEmailHash: string,
    now: Date
  ): Promise<AnonymousPass[]> {
    return this.rows.filter(
      (r) =>
        r.buyer_email_hash === buyerEmailHash &&
        r.claimed_by_user_id == null &&
        r.expires_at > now
    );
  }

  async findUnclaimedWithoutEmailHash(now: Date): Promise<AnonymousPass[]> {
    return this.rows.filter(
      (r) =>
        r.buyer_email_hash == null &&
        r.claimed_by_user_id == null &&
        r.expires_at > now
    );
  }

  async setBuyerEmailHash(id: number, buyerEmailHash: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row && row.buyer_email_hash == null) {
      row.buyer_email_hash = buyerEmailHash;
    }
  }

  async claim(id: number, userId: number): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id);
    if (row == null || row.claimed_by_user_id != null) return false;
    row.claimed_by_user_id = userId;
    return true;
  }

  async unclaim(id: number): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.claimed_by_user_id = null;
  }

  async findById(id: number): Promise<AnonymousPass | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  clear(): void {
    this.rows.length = 0;
    this.nextId = 1;
  }
}

export default AnonymousPassRepository;
