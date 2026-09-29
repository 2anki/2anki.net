import type { Knex } from 'knex';

import type HeldDecks from './public/HeldDecks';

export interface HeldDeckInsert {
  storageKey: string;
  anonId: string;
  filename: string;
  cardCount: number;
  cardsHeldBack: number;
  expiresAt: Date;
}

export interface ExpiredHeldDeck {
  id: number;
  storageKey: string;
}

export interface IHeldDeckRepository {
  insert(row: HeldDeckInsert): Promise<HeldDecks>;
  findNewestClaimable(anonId: string, now: Date): Promise<HeldDecks | null>;
  findNewestByAnonId(anonId: string): Promise<HeldDecks | null>;
  /** Claims the row only if nobody has; false means another claim won. */
  markClaimed(id: number, claimedBy: number, claimedAt: Date): Promise<boolean>;
  releaseClaim(id: number): Promise<void>;
  findExpired(now: Date, claimedBefore: Date): Promise<ExpiredHeldDeck[]>;
  deleteByIds(ids: number[]): Promise<void>;
}

export class HeldDeckRepository implements IHeldDeckRepository {
  private readonly table = 'held_decks';

  constructor(private readonly database: Knex) {}

  buildInsertQuery(row: HeldDeckInsert): Knex.QueryBuilder {
    return this.database(this.table)
      .insert({
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
      .whereNull('claimed_at')
      .update({ claimed_at: claimedAt, claimed_by: claimedBy });
  }

  async markClaimed(
    id: number,
    claimedBy: number,
    claimedAt: Date
  ): Promise<boolean> {
    const updated = (await this.buildMarkClaimedQuery(
      id,
      claimedBy,
      claimedAt
    )) as number;
    return updated > 0;
  }

  buildReleaseClaimQuery(id: number): Knex.QueryBuilder {
    return this.database(this.table)
      .where('id', id)
      .update({ claimed_at: null, claimed_by: null });
  }

  async releaseClaim(id: number): Promise<void> {
    await this.buildReleaseClaimQuery(id);
  }

  buildFindExpiredQuery(now: Date, claimedBefore: Date): Knex.QueryBuilder {
    return this.database(this.table)
      .select('id', 'storage_key')
      .where('expires_at', '<=', now)
      .orWhere((qb) =>
        qb.whereNotNull('claimed_at').where('claimed_at', '<', claimedBefore)
      );
  }

  async findExpired(
    now: Date,
    claimedBefore: Date
  ): Promise<ExpiredHeldDeck[]> {
    const rows = (await this.buildFindExpiredQuery(now, claimedBefore)) as {
      id: number;
      storage_key: string;
    }[];
    return rows.map((row) => ({ id: row.id, storageKey: row.storage_key }));
  }

  buildDeleteByIdsQuery(ids: number[]): Knex.QueryBuilder {
    return this.database(this.table).whereIn('id', ids).del();
  }

  async deleteByIds(ids: number[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.buildDeleteByIdsQuery(ids);
  }
}

export class InMemoryHeldDeckRepository implements IHeldDeckRepository {
  readonly rows: HeldDecks[] = [];
  private nextId = 1;

  async insert(row: HeldDeckInsert): Promise<HeldDecks> {
    const stored = {
      id: this.nextId++,
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
        (row) =>
          row.claimed_at == null && row.expires_at.getTime() > now.getTime()
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
  ): Promise<boolean> {
    const row = this.rows.find((r) => r.id === (id as HeldDecks['id']));
    if (row == null || row.claimed_at != null) {
      return false;
    }
    row.claimed_at = claimedAt;
    row.claimed_by = claimedBy as HeldDecks['claimed_by'];
    return true;
  }

  async releaseClaim(id: number): Promise<void> {
    const row = this.rows.find((r) => r.id === (id as HeldDecks['id']));
    if (row != null) {
      row.claimed_at = null;
      row.claimed_by = null;
    }
  }

  async findExpired(
    now: Date,
    claimedBefore: Date
  ): Promise<ExpiredHeldDeck[]> {
    return this.rows
      .filter(
        (row) =>
          row.expires_at.getTime() <= now.getTime() ||
          (row.claimed_at != null &&
            row.claimed_at.getTime() < claimedBefore.getTime())
      )
      .map((row) => ({ id: row.id as number, storageKey: row.storage_key }));
  }

  async deleteByIds(ids: number[]): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      if (ids.includes(this.rows[i].id as number)) {
        this.rows.splice(i, 1);
      }
    }
  }
}

export default HeldDeckRepository;
