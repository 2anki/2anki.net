import knexFactory from 'knex';

describe('ShareRepository — generated SQL shape', () => {
  const pgKnex = knexFactory({ client: 'pg' });

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
});
