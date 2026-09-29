import type { Knex } from 'knex';

import type HeldDecks from './public/HeldDecks';

export interface HeldDeckInsert {
  claimKey: string;
  storageKey: string;
  anonId: string;
  filename: string;
  cardCount: number;
  cardsHeldBack: number;
  expiresAt: Date;
}

export interface IHeldDeckRepository {
  insert(row: HeldDeckInsert): Promise<HeldDecks>;
  findNewestClaimable(anonId: string, now: Date): Promise<HeldDecks | null>;
  findNewestByAnonId(anonId: string): Promise<HeldDecks | null>;
  markClaimed(id: number, claimedBy: number, claimedAt: Date): Promise<void>;
  deleteExpired(now: Date, claimedBefore: Date): Promise<string[]>;
}

export class HeldDeckRepository implements IHeldDeckRepository {
  private readonly table = 'held_decks';

  constructor(private readonly database: Knex) {}

  buildInsertQuery(row: HeldDeckInsert): Knex.QueryBuilder {
    return this.database(this.table)
      .insert({
        claim_key: row.claimKey,
        storage_key: row.storageKey,
        anon_id: row.anonId,
        filename: row.filename,
        card_count: row.cardCount,
        cards_held_back: row.cardsHeldBack,
        expires_at: row.expiresAt,
      })
      .returning('*');
  }

  async insert(row: HeldDeckInsert): Promise<HeldDecks> {
    const [inserted] = (await this.buildInsertQuery(row)) as HeldDecks[];
    return inserted;
  }

  buildFindNewestClaimableQuery(anonId: string, now: Date): Knex.QueryBuilder {
    return this.database(this.table)
      .where('anon_id', anonId)
      .whereNull('claimed_at')
      .where('expires_at', '>', now)
      .orderBy('created_at', 'desc')
      .first();
  }

  async findNewestClaimable(
    anonId: string,
    now: Date
  ): Promise<HeldDecks | null> {
    const row = (await this.buildFindNewestClaimableQuery(anonId, now)) as
      | HeldDecks
      | undefined;
    return row ?? null;
  }

  buildFindNewestByAnonIdQuery(anonId: string): Knex.QueryBuilder {
    return this.database(this.table)
      .where('anon_id', anonId)
      .orderBy('created_at', 'desc')
      .first();
  }

  async findNewestByAnonId(anonId: string): Promise<HeldDecks | null> {
    const row = (await this.buildFindNewestByAnonIdQuery(anonId)) as
      | HeldDecks
      | undefined;
    return row ?? null;
  }

  buildMarkClaimedQuery(
    id: number,
    claimedBy: number,
    claimedAt: Date
  ): Knex.QueryBuilder {
    return this.database(this.table)
      .where('id', id)
      .update({ claimed_at: claimedAt, claimed_by: claimedBy });
  }

  async markClaimed(
    id: number,
    claimedBy: number,
    claimedAt: Date
  ): Promise<void> {
    await this.buildMarkClaimedQuery(id, claimedBy, claimedAt);
  }

  buildDeleteExpiredQuery(now: Date, claimedBefore: Date): Knex.QueryBuilder {
    return this.database(this.table)
      .where('expires_at', '<=', now)
      .orWhere((qb) =>
        qb.whereNotNull('claimed_at').where('claimed_at', '<', claimedBefore)
      )
      .del()
      .returning('storage_key');
  }

  async deleteExpired(now: Date, claimedBefore: Date): Promise<string[]> {
    const rows = (await this.buildDeleteExpiredQuery(now, claimedBefore)) as {
      storage_key: string;
    }[];
    return rows.map((row) => row.storage_key);
  }
}

export class InMemoryHeldDeckRepository implements IHeldDeckRepository {
  readonly rows: HeldDecks[] = [];
  private nextId = 1;

  async insert(row: HeldDeckInsert): Promise<HeldDecks> {
    const stored = {
      id: this.nextId++,
      claim_key: row.claimKey,
      storage_key: row.storageKey,
      anon_id: row.anonId,
      filename: row.filename,
      card_count: row.cardCount,
      cards_held_back: row.cardsHeldBack,
      created_at: new Date(),
      expires_at: row.expiresAt,
      claimed_at: null,
      claimed_by: null,
    } as HeldDecks;
    this.rows.push(stored);
    return stored;
  }

  private newestForAnon(anonId: string): HeldDecks[] {
    return this.rows
      .filter((row) => row.anon_id === anonId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  async findNewestClaimable(
    anonId: string,
    now: Date
  ): Promise<HeldDecks | null> {
    return (
      this.newestForAnon(anonId).find(
        (row) => row.claimed_at == null && row.expires_at.getTime() > now.getTime()
      ) ?? null
    );
  }

  async findNewestByAnonId(anonId: string): Promise<HeldDecks | null> {
    return this.newestForAnon(anonId)[0] ?? null;
  }

  async markClaimed(
    id: number,
    claimedBy: number,
    claimedAt: Date
  ): Promise<void> {
    const row = this.rows.find((r) => r.id === (id as HeldDecks['id']));
    if (row != null) {
      row.claimed_at = claimedAt;
      row.claimed_by = claimedBy as HeldDecks['claimed_by'];
    }
  }

  async deleteExpired(now: Date, claimedBefore: Date): Promise<string[]> {
    const removed: string[] = [];
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      const row = this.rows[i];
      const expired = row.expires_at.getTime() <= now.getTime();
      const longClaimed =
        row.claimed_at != null &&
        row.claimed_at.getTime() < claimedBefore.getTime();
      if (expired || longClaimed) {
        removed.push(row.storage_key);
        this.rows.splice(i, 1);
      }
    }
    return removed;
  }
}

export default HeldDeckRepository;
