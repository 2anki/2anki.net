import knex, { Knex } from 'knex';

import UsersRepository from './UsersRepository';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const LATER = new Date('2026-10-01T13:00:00.000Z');

describe('UsersRepository email change relinks the rows the old address receives', () => {
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
      t.text('email').notNullable().unique();
      t.boolean('email_verified').notNullable().defaultTo(true);
      t.text('stripe_customer_id').nullable();
      t.text('created_at').nullable();
      t.text('reset_token').nullable();
      t.timestamp('reset_token_expires_at').nullable();
      t.timestamp('reset_token_used_at').nullable();
    });
    await database.schema.createTable('subscriptions', (t) => {
      t.increments('id').primary();
      t.text('email').unique();
      t.text('linked_email').index();
      t.boolean('active').defaultTo(false);
      t.text('payload');
      t.text('created_at');
    });
    await database.schema.createTable('email_change_tokens', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.timestamp('expires_at').notNullable();
      t.timestamp('consumed_at').nullable();
    });
    await database.schema.createTable('pause_resume_warning_notices', (t) => {
      t.increments('id').primary();
      t.text('subscription_email').notNullable();
      t.timestamp('resumes_at').notNullable();
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

  async function seedAccount(email: string): Promise<number> {
    const [{ id }] = await database('users')
      .insert({ email, stripe_customer_id: `cus_${email}` })
      .returning('id');
    return id as number;
  }

  async function seedRow(email: string, linkedEmail: string | null) {
    await database('subscriptions').insert({
      email,
      linked_email: linkedEmail,
      active: true,
      payload: '{}',
    });
  }

  const linkOf = async (email: string) =>
    (await database('subscriptions').where({ email }).first()).linked_email;

  const confirmChange = async (userId: number) => {
    const [{ id: tokenId }] = await database('email_change_tokens')
      .insert({ user_id: userId, expires_at: LATER })
      .returning('id');
    return repo.applyEmailChange({
      userId,
      newEmail: 'new@example.com',
      tokenId: tokenId as number,
      now: NOW,
    });
  };

  const opsChange = () =>
    repo.changeEmailAndRelinkSubscriptions(
      'old@example.com',
      'new@example.com'
    );

  describe.each([
    ['a confirmed change', (userId: number) => confirmChange(userId)],
    ['an ops change', () => opsChange()],
  ])('on %s', (_path, change) => {
    it('leaves a plan the account pays for someone else with that person', async () => {
      const userId = await seedAccount('old@example.com');
      await seedAccount('friend@example.com');
      await seedRow('old@example.com', 'friend@example.com');

      await change(userId);

      expect(await linkOf('old@example.com')).toBe('friend@example.com');
    });

    it('moves the account own plan and a plan linked to it together', async () => {
      const userId = await seedAccount('old@example.com');
      await seedRow('old@example.com', null);
      await seedRow('payer@example.com', 'old@example.com');

      await change(userId);

      expect(await linkOf('old@example.com')).toBe('new@example.com');
      expect(await linkOf('payer@example.com')).toBe('new@example.com');
    });
  });

  it('confirms the change when two rows end up linked to the new address', async () => {
    const userId = await seedAccount('old@example.com');
    await seedRow('old@example.com', null);
    await seedRow('payer@example.com', 'old@example.com');

    expect(await confirmChange(userId)).toEqual({ ok: true });
  });
});
