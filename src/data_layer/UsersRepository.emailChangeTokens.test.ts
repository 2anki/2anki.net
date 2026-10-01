import knex, { Knex } from 'knex';

import UsersRepository from './UsersRepository';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const LATER = new Date('2026-10-01T13:00:00.000Z');

describe('UsersRepository email change voids links mailed to the old address', () => {
  let database: Knex;
  let repo: UsersRepository;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await database.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
      t.text('reset_token').nullable();
      t.timestamp('reset_token_expires_at').nullable();
      t.timestamp('reset_token_used_at').nullable();
    });
    await database.schema.createTable('subscriptions', (t) => {
      t.increments('id').primary();
      t.text('email');
      t.text('linked_email');
    });
    await database.schema.createTable('email_change_tokens', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.timestamp('expires_at').notNullable();
      t.timestamp('consumed_at').nullable();
    });
    await database.schema.createTable('magic_tokens', (t) => {
      t.increments('id').primary();
      t.text('token').notNullable();
      t.integer('owner').notNullable();
      t.timestamp('expires_at').notNullable();
      t.timestamp('used_at').nullable();
    });
    repo = new UsersRepository(database);
  });

  afterEach(async () => {
    await database.destroy();
  });

  async function seedUserWithPendingLinks(email: string): Promise<number> {
    const [{ id }] = await database('users')
      .insert({
        email,
        reset_token: 'pending-reset',
        reset_token_expires_at: LATER,
      })
      .returning('id');
    await database('magic_tokens').insert([
      { token: 'pending-magic', owner: id, expires_at: LATER },
      { token: 'used-magic', owner: id, expires_at: LATER, used_at: NOW },
    ]);
    return id as number;
  }

  async function unusedMagicTokens(owner: number) {
    return database('magic_tokens').where({ owner }).whereNull('used_at');
  }

  it('clears the reset token and spends magic links on a confirmed change', async () => {
    const userId = await seedUserWithPendingLinks('old@example.com');
    const [{ id: tokenId }] = await database('email_change_tokens')
      .insert({ user_id: userId, expires_at: LATER })
      .returning('id');

    const result = await repo.applyEmailChange({
      userId,
      newEmail: 'new@example.com',
      tokenId: tokenId as number,
      now: NOW,
    });

    expect(result).toEqual({ ok: true });
    const user = await database('users').where({ id: userId }).first();
    expect(user).toMatchObject({
      email: 'new@example.com',
      reset_token: null,
      reset_token_expires_at: null,
    });
    expect(await unusedMagicTokens(userId)).toEqual([]);
  });

  it('clears the reset token and spends magic links on an ops change', async () => {
    const userId = await seedUserWithPendingLinks('old@example.com');
    const otherId = await seedUserWithPendingLinks('other@example.com');

    await database('email_change_tokens').insert({
      user_id: userId,
      expires_at: LATER,
    });

    await repo.changeEmailAndRelinkSubscriptions(
      'Old@Example.com',
      'new@example.com'
    );

    expect(
      await database('email_change_tokens')
        .where({ user_id: userId })
        .whereNull('consumed_at')
    ).toEqual([]);

    const user = await database('users').where({ id: userId }).first();
    expect(user).toMatchObject({
      email: 'new@example.com',
      reset_token: null,
      reset_token_expires_at: null,
    });
    expect(await unusedMagicTokens(userId)).toEqual([]);
    const other = await database('users').where({ id: otherId }).first();
    expect(other).toMatchObject({ reset_token: 'pending-reset' });
    expect(await unusedMagicTokens(otherId)).toHaveLength(1);
  });

  it('leaves pending links alone when the change is refused', async () => {
    const userId = await seedUserWithPendingLinks('old@example.com');
    await seedUserWithPendingLinks('taken@example.com');
    const [{ id: tokenId }] = await database('email_change_tokens')
      .insert({ user_id: userId, expires_at: LATER })
      .returning('id');

    const result = await repo.applyEmailChange({
      userId,
      newEmail: 'taken@example.com',
      tokenId: tokenId as number,
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: 'email_taken' });
    const user = await database('users').where({ id: userId }).first();
    expect(user).toMatchObject({ reset_token: 'pending-reset' });
    expect(await unusedMagicTokens(userId)).toHaveLength(1);
  });
});
