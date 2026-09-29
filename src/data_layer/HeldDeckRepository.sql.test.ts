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
        claimKey: 'claim-1',
        storageKey: 'held/abc.html',
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
    expect(sql).toContain('returning *');
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

  it('finds the newest hold for an anonymous id regardless of state', () => {
    const { sql, bindings } = repository
      .buildFindNewestByAnonIdQuery('anon-1')
      .toSQL();

    expect(sql).toBe(
      'select * from "held_decks" where "anon_id" = ? order by "created_at" desc limit ?'
    );
    expect(bindings).toEqual(['anon-1', 1]);
  });

  it('stamps the claim on a single row', () => {
    const claimedAt = new Date('2026-09-29T01:00:00.000Z');
    const { sql, bindings } = repository
      .buildMarkClaimedQuery(42, 7, claimedAt)
      .toSQL();

    expect(sql).toBe(
      'update "held_decks" set "claimed_at" = ?, "claimed_by" = ? where "id" = ?'
    );
    expect(bindings).toEqual([claimedAt, 7, 42]);
  });

  it('deletes expired or long-claimed holds and returns their storage keys', () => {
    const claimedBefore = new Date('2026-09-28T00:00:00.000Z');
    const { sql, bindings } = repository
      .buildDeleteExpiredQuery(now, claimedBefore)
      .toSQL();

    expect(sql).toBe(
      'delete from "held_decks" where "expires_at" <= ? or ("claimed_at" is not null and "claimed_at" < ?) returning "storage_key"'
    );
    expect(bindings).toEqual([now, claimedBefore]);
  });
});
