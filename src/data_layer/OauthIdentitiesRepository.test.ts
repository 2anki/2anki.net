process.env.THE_HASHING_SECRET = 'test-secret-for-jest';

import knex, { Knex } from 'knex';

import OauthIdentitiesRepository from './OauthIdentitiesRepository';
import { UsersId } from './public/Users';

describe('OauthIdentitiesRepository', () => {
  let database: Knex;
  let repo: OauthIdentitiesRepository;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await database.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
    });
    await database.schema.createTable('oauth_identities', (t) => {
      t.increments('id').primary();
      t.text('provider').notNullable();
      t.text('subject').notNullable();
      t.integer('user_id')
        .notNullable()
        .references('id')
        .inTable('users')
        .onDelete('CASCADE');
      t.timestamp('created_at').notNullable().defaultTo(database.fn.now());
      t.text('refresh_token').nullable().defaultTo(null);
      t.unique(['provider', 'subject']);
    });
    repo = new OauthIdentitiesRepository(database);
  });

  afterEach(async () => {
    await database.destroy();
  });

  const insertUser = async (email: string): Promise<UsersId> => {
    const [{ id }] = await database('users').insert({ email }).returning('id');
    return id as UsersId;
  };

  it('keeps the first link when a concurrent callback links the same identity', async () => {
    const userId = await insertUser('user@example.com');
    await repo.link('microsoft', 'sub-1', userId);

    await expect(repo.link('microsoft', 'sub-1', userId)).resolves.toBe(
      undefined
    );
    const rows = await database('oauth_identities').where({
      provider: 'microsoft',
      subject: 'sub-1',
    });
    expect(rows).toHaveLength(1);
  });

  it('builds a Postgres insert that ignores a provider+subject conflict', () => {
    const pg = knex({ client: 'pg' });
    const sql = new OauthIdentitiesRepository(pg)
      .buildLinkQuery('microsoft', 'sub-1', 7 as UsersId)
      .toString();
    expect(sql).toContain('on conflict ("provider", "subject") do nothing');
  });

  it('returns null when no matching identity exists', async () => {
    const row = await repo.findByProviderAndSubject('microsoft', 'sub-1');
    expect(row).toBeNull();
  });

  it('returns the identity row when one exists', async () => {
    const userId = await insertUser('user@example.com');
    await repo.link('microsoft', 'sub-1', userId);

    const row = await repo.findByProviderAndSubject('microsoft', 'sub-1');
    expect(row).toMatchObject({
      provider: 'microsoft',
      subject: 'sub-1',
      user_id: userId,
    });
  });

  it('isolates lookups by provider', async () => {
    const userId = await insertUser('user@example.com');
    await repo.link('google', 'sub-1', userId);

    const row = await repo.findByProviderAndSubject('microsoft', 'sub-1');
    expect(row).toBeNull();
  });

  it('encrypts the refresh token at rest when linking', async () => {
    const userId = await insertUser('user@example.com');
    await repo.link('apple', 'sub-apple', userId, 'apple-refresh-1');

    const row = await repo.findByProviderAndSubject('apple', 'sub-apple');
    expect(row?.refresh_token).not.toBeNull();
    expect(row?.refresh_token).not.toBe('apple-refresh-1');
  });

  it('returns the raw refresh token after a link round-trip', async () => {
    const userId = await insertUser('user@example.com');
    await repo.link('apple', 'sub-apple', userId, 'apple-refresh-1');

    const token = await repo.findRefreshTokenByUserAndProvider(userId, 'apple');
    expect(token).toBe('apple-refresh-1');
  });

  it('stores null when link is called without a refresh token', async () => {
    const userId = await insertUser('user@example.com');
    await repo.link('apple', 'sub-apple', userId);

    const row = await repo.findByProviderAndSubject('apple', 'sub-apple');
    expect(row?.refresh_token).toBeNull();
  });

  it('updates the refresh token for an existing identity and encrypts it at rest', async () => {
    const userId = await insertUser('user@example.com');
    await repo.link('apple', 'sub-apple', userId, 'apple-refresh-old');

    await repo.updateRefreshToken('apple', 'sub-apple', 'apple-refresh-new');

    const row = await repo.findByProviderAndSubject('apple', 'sub-apple');
    expect(row?.refresh_token).not.toBe('apple-refresh-new');

    const token = await repo.findRefreshTokenByUserAndProvider(userId, 'apple');
    expect(token).toBe('apple-refresh-new');
  });

  it('reads back the raw refresh token by user and provider', async () => {
    const userId = await insertUser('user@example.com');
    await repo.link('apple', 'sub-apple', userId, 'apple-refresh-2');

    const token = await repo.findRefreshTokenByUserAndProvider(userId, 'apple');
    expect(token).toBe('apple-refresh-2');
  });

  it('returns null from findRefreshTokenByUserAndProvider when no identity exists', async () => {
    const userId = await insertUser('user@example.com');

    const token = await repo.findRefreshTokenByUserAndProvider(userId, 'apple');
    expect(token).toBeNull();
  });
});
