import knex, { Knex } from 'knex';

import UsersRepository from './UsersRepository';

const ADDRESS = 'payer@example.com';
const SUBSCRIBED = '2026-02-01T00:00:00.000Z';
const SIGNED_UP_LATER = '2026-03-01T00:00:00.000Z';
const STORED_HASH = 'stored-password-hash';

describe('UsersRepository.markEmailVerified', () => {
  let database: Knex;
  let repository: UsersRepository;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await database.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
      t.text('password').notNullable();
      t.boolean('email_verified').notNullable().defaultTo(false);
      t.text('created_at').nullable();
    });
    await database.schema.createTable('subscriptions', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
      t.text('linked_email').nullable();
      t.text('payload').nullable();
      t.text('created_at').nullable();
    });
    await database.schema.createTable('access_tokens', (t) => {
      t.integer('owner').notNullable();
      t.text('token').notNullable();
    });
    for (const table of ['mcp_access_tokens', 'mcp_refresh_tokens']) {
      await database.schema.createTable(table, (t) => {
        t.integer('user_id').notNullable();
        t.timestamp('revoked_at').nullable();
      });
      await database(table).insert([{ user_id: 7 }, { user_id: 8 }]);
    }
    await database.schema.createTable('email_change_tokens', (t) => {
      t.integer('user_id').notNullable();
      t.timestamp('consumed_at').nullable();
    });
    await database('email_change_tokens').insert([
      { user_id: 7 },
      { user_id: 8 },
    ]);
    await database('users').insert({
      id: 7,
      email: ADDRESS,
      password: STORED_HASH,
      created_at: SIGNED_UP_LATER,
    });
    await database('access_tokens').insert([
      { owner: 7, token: 'held-by-whoever-signed-up' },
      { owner: 8, token: 'someone-else' },
    ]);
    repository = new UsersRepository(database);
  });

  afterEach(async () => {
    await database.destroy();
  });

  const seedRow = () =>
    database('subscriptions').insert({
      email: ADDRESS,
      linked_email: 'owner@example.com',
      payload: JSON.stringify({ id: 'sub_1', metadata: {} }),
      created_at: SUBSCRIBED,
    });

  const account = () => database('users').where({ id: 7 }).first();
  const sessions = () => database('access_tokens').pluck('token');
  const openTokens = (table: string, closedColumn: string) =>
    database(table).whereNull(closedColumn).pluck('user_id');

  it('ends the sessions and password of an account that held the address unproven', async () => {
    await seedRow();

    await repository.markEmailVerified('7');

    const user = await account();
    expect(Boolean(user.email_verified)).toBe(true);
    expect(user.password).not.toBe(STORED_HASH);
    await expect(sessions()).resolves.toEqual(['someone-else']);
  });

  it.each(['mcp_access_tokens', 'mcp_refresh_tokens'])(
    'revokes the %s of an account that held the address unproven',
    async (table) => {
      await seedRow();

      await repository.markEmailVerified('7');

      await expect(openTokens(table, 'revoked_at')).resolves.toEqual([8]);
    }
  );

  it('spends a pending email change of an account that held the address unproven', async () => {
    await seedRow();

    await repository.markEmailVerified('7');

    await expect(
      openTokens('email_change_tokens', 'consumed_at')
    ).resolves.toEqual([8]);
  });

  it('counts an account named by its own checkout as holding the address unproven', async () => {
    await database('subscriptions').insert({
      email: ADDRESS,
      payload: JSON.stringify({ id: 'sub_1', metadata: { user_id: '7' } }),
      created_at: SIGNED_UP_LATER,
    });

    await repository.markEmailVerified('7');

    expect((await account()).password).not.toBe(STORED_HASH);
  });

  it('keeps the sessions and password of an account with no plan on the address', async () => {
    await repository.markEmailVerified('7');

    const user = await account();
    expect(Boolean(user.email_verified)).toBe(true);
    expect(user.password).toBe(STORED_HASH);
    await expect(sessions()).resolves.toHaveLength(2);
  });

  it('keeps them for an account already verified', async () => {
    await seedRow();
    await database('users').where({ id: 7 }).update({ email_verified: true });

    await repository.markEmailVerified('7');

    expect((await account()).password).toBe(STORED_HASH);
    await expect(sessions()).resolves.toHaveLength(2);
  });

  it('keeps a password the mailbox owner just set in a reset', async () => {
    await seedRow();

    await repository.markEmailVerifiedAfterReset('7');

    const user = await account();
    expect(Boolean(user.email_verified)).toBe(true);
    expect(user.password).toBe(STORED_HASH);
  });

  it('ends MCP access and a pending email change on a reset too', async () => {
    await seedRow();

    await repository.markEmailVerifiedAfterReset('7');

    await expect(
      openTokens('mcp_refresh_tokens', 'revoked_at')
    ).resolves.toEqual([8]);
    await expect(
      openTokens('email_change_tokens', 'consumed_at')
    ).resolves.toEqual([8]);
  });
});
