import knex from 'knex';

import { UserPreferencesRepository } from './UserPreferencesRepository';

describe('UserPreferencesRepository generated SQL', () => {
  const pg = knex({ client: 'pg' });
  const repository = new UserPreferencesRepository(pg);

  afterAll(async () => {
    await pg.destroy();
  });

  it('merges patched card options into the stored jsonb instead of replacing it', () => {
    const { sql, bindings } = repository
      .buildMergeCardOptionsQuery(7, { deckName: 'Week 1' })
      .toSQL();

    expect(sql).toBe(
      'update "users" set "card_options" = coalesce(card_options, \'{}\'::jsonb) || ?::jsonb where "id" = ?'
    );
    expect(bindings).toEqual(['{"deckName":"Week 1"}', 7]);
  });

  it('removes a single card option key from the stored jsonb', () => {
    const { sql, bindings } = repository
      .buildRemoveCardOptionQuery(7, 'block-id-identity')
      .toSQL();

    expect(sql).toBe(
      'update "users" set "card_options" = card_options - ?::text where "id" = ?'
    );
    expect(bindings).toEqual(['block-id-identity', 7]);
  });
});
