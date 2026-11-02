import knex from 'knex';

import { HeldDeckRepository } from './HeldDeckRepository';

describe('HeldDeckRepository generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new HeldDeckRepository(pg);
  const now = new Date('2026-09-29T00:00:00.000Z');

  afterAll(async () => {
    await pg.destroy();
  });

  it('inserts a hold with all columns and returns the row', () => {
    const { sql } = repository
      .buildInsertQuery({
        storageKey: 'held/abc',
        anonId: 'anon-1',
        filename: 'notes.html',
        cardCount: 21,
        cardsHeldBack: 13,
        expiresAt: now,
      })
      .toSQL();

    expect(sql).toContain('insert into "held_decks"');
    expect(sql).toContain('"anon_id"');
    expect(sql).toContain('"card_count"');
    expect(sql).toContain('"cards_held_back"');
    expect(sql).toContain('"storage_key"');
    expect(sql).not.toContain('claim_key');
    expect(sql).toContain('returning *');
  });

  it('stores the card options as one JSON binding', () => {
    const { sql, bindings } = repository
      .buildInsertQuery({
        storageKey: 'held/abc',
        anonId: 'plan:7',
        filename: 'notes.html',
        cardCount: 10,
        cardsHeldBack: 110,
        expiresAt: now,
        cardOptions: { deckName: 'Biology', 'global-tags': 'cells' },
      })
      .toSQL();

    expect(sql).toContain('"card_options"');
    expect(bindings).toContain('{"deckName":"Biology","global-tags":"cells"}');
  });

  it('stores no card options as null', () => {
    const { bindings } = repository
      .buildInsertQuery({
        storageKey: 'held/abc',
        anonId: 'anon-1',
        filename: 'notes.html',
        cardCount: 21,
        cardsHeldBack: 13,
        expiresAt: now,
      })
      .toSQL();

    expect(bindings).toContain(null);
  });

  it('finds the newest unclaimed, unexpired hold for an anonymous id', () => {
    const { sql, bindings } = repository
      .buildFindNewestClaimableQuery('anon-1', now)
      .toSQL();

    expect(sql).toBe(
      'select * from "held_decks" where "anon_id" = ? and "claimed_at" is null and "expires_at" > ? order by "created_at" desc limit ?'
    );
    expect(bindings).toEqual(['anon-1', now, 1]);
  });

  it('lists unclaimed, unexpired holds for a key, newest first, up to a limit', () => {
    const { sql, bindings } = repository
      .buildFindClaimableQuery('plan:7', now, 5)
      .toSQL();

    expect(sql).toBe(
      'select * from "held_decks" where "anon_id" = ? and "claimed_at" is null and "expires_at" > ? order by "created_at" desc limit ?'
    );
    expect(bindings).toEqual(['plan:7', now, 5]);
  });

  it('finds the newest hold for an anonymous id regardless of state', () => {
    const { sql, bindings } = repository
      .buildFindNewestByAnonIdQuery('anon-1')
      .toSQL();

    expect(sql).toBe(
      'select * from "held_decks" where "anon_id" = ? order by "created_at" desc limit ?'
    );
    expect(bindings).toEqual(['anon-1', 1]);
  });

  it('lists every unclaimed hold for an anonymous id with its storage key', () => {
    const { sql, bindings } = repository
      .buildFindUnclaimedByAnonIdQuery('anon-1')
      .toSQL();

    expect(sql).toBe(
      'select "id", "storage_key" from "held_decks" where "anon_id" = ? and "claimed_at" is null'
    );
    expect(bindings).toEqual(['anon-1']);
  });

  it('stamps the claim only on a row nobody has claimed yet', () => {
    const claimedAt = new Date('2026-09-29T01:00:00.000Z');
    const { sql, bindings } = repository
      .buildMarkClaimedQuery(42, 7, claimedAt)
      .toSQL();

    expect(sql).toBe(
      'update "held_decks" set "claimed_at" = ?, "claimed_by" = ? where "id" = ? and "claimed_at" is null'
    );
    expect(bindings).toEqual([claimedAt, 7, 42]);
  });

  it("releases only the claimant's own claim by clearing both claim columns", () => {
    const { sql, bindings } = repository.buildReleaseClaimQuery(42, 7).toSQL();

    expect(sql).toBe(
      'update "held_decks" set "claimed_at" = ?, "claimed_by" = ? where "id" = ? and "claimed_by" = ?'
    );
    expect(bindings).toEqual([null, null, 42, 7]);
  });

  it('lists expired or long-claimed holds with their storage keys', () => {
    const claimedBefore = new Date('2026-09-28T00:00:00.000Z');
    const { sql, bindings } = repository
      .buildFindExpiredQuery(now, claimedBefore)
      .toSQL();

    expect(sql).toBe(
      'select "id", "storage_key" from "held_decks" where "expires_at" <= ? or ("claimed_at" is not null and "claimed_at" < ?)'
    );
    expect(bindings).toEqual([now, claimedBefore]);
  });

  it('deletes swept rows by id', () => {
    const { sql, bindings } = repository.buildDeleteByIdsQuery([1, 2]).toSQL();

    expect(sql).toBe('delete from "held_decks" where "id" in (?, ?)');
    expect(bindings).toEqual([1, 2]);
  });

  it('prunes only still-unclaimed rows and returns the ids removed', () => {
    const { sql, bindings } = repository
      .buildDeleteUnclaimedByIdsQuery([1, 2])
      .toSQL();

    expect(sql).toBe(
      'delete from "held_decks" where "id" in (?, ?) and "claimed_at" is null returning "id"'
    );
    expect(bindings).toEqual([1, 2]);
  });
});
