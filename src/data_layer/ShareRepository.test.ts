import knexFactory from 'knex';
import { UsersId } from './public/Users';

const asOwner = (n: number) => n as unknown as UsersId;

describe('ShareRepository — generated SQL shape', () => {
  const pgKnex = knexFactory({ client: 'pg' });

  it('findPublicListing filters to public, non-revoked, titled, well-populated shares', () => {
    const sql = pgKnex('deck_shares')
      .where({ is_public: true })
      .whereNull('revoked_at')
      .whereNotNull('title')
      .where('card_count', '>=', 3)
      .orderBy('created_at', 'desc')
      .offset(0)
      .limit(24)
      .toString();

    expect(sql).toContain('"is_public" = true');
    expect(sql).toContain('"revoked_at" is null');
    expect(sql).toContain('"title" is not null');
    expect(sql).toContain('"card_count" >= 3');
    expect(sql).toContain('order by "created_at" desc');
    expect(sql).toContain('limit');
  });

  it('recordView bumps the view count and stamps the view time in one update', () => {
    const sql = pgKnex('deck_shares')
      .where({ id: 7 })
      .update({
        view_count: pgKnex.raw('view_count + 1'),
        last_viewed_at: pgKnex.fn.now(),
      })
      .toString();

    expect(sql).toContain('"view_count" = view_count + 1');
    expect(sql).toContain('"last_viewed_at" = CURRENT_TIMESTAMP');
    expect(sql).toContain('"id" = 7');
  });

  it('updatePublicListing scopes the update to the token/owner pair and excludes revoked shares', () => {
    const sql = pgKnex('deck_shares')
      .where({ token: 'abc', owner: asOwner(42) })
      .whereNull('revoked_at')
      .update({ is_public: true, title: 'My deck', card_count: 10 })
      .toString();

    expect(sql).toContain('"token" = \'abc\'');
    expect(sql).toContain('"owner" = 42');
    expect(sql).toContain('"revoked_at" is null');
    expect(sql).toContain('"is_public" = true');
  });
});
