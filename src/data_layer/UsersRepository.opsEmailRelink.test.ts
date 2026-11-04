import knex, { Knex } from 'knex';

import UsersRepository from './UsersRepository';

describe('UsersRepository.changeEmailAndRelinkSubscriptions relinks subscriptions', () => {
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
    });
    await database.schema.createTable('subscriptions', (t) => {
      t.increments('id').primary();
      t.text('email').unique();
      t.text('linked_email').unique().nullable();
      t.boolean('active').defaultTo(true);
    });
    await database.schema.createTable('email_change_tokens', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.timestamp('consumed_at').nullable();
    });
    await database.schema.createTable('pause_resume_warning_notices', (t) => {
      t.increments('id').primary();
      t.text('subscription_email').notNullable();
      t.timestamp('resumes_at').notNullable();
    });
    await database.schema.createTable('magic_tokens', (t) => {
      t.increments('id').primary();
      t.integer('owner').notNullable();
      t.timestamp('used_at').nullable();
    });
    await database('users').insert({ email: 'old@example.com' });
    repo = new UsersRepository(database);
  });

  afterEach(async () => {
    await database.destroy();
  });

  async function linkedEmailOf(payer: string) {
    const row = await database('subscriptions').where({ email: payer }).first();
    return row.linked_email;
  }

  it('moves a subscription someone else pays for to the new address', async () => {
    await database('subscriptions').insert({
      email: 'payer@example.com',
      linked_email: 'old@example.com',
    });

    await repo.changeEmailAndRelinkSubscriptions(
      'old@example.com',
      'new@example.com'
    );

    expect(await linkedEmailOf('payer@example.com')).toBe('new@example.com');
  });

  it("links the user's own subscription to the new address", async () => {
    await database('subscriptions').insert({
      email: 'old@example.com',
      linked_email: null,
    });

    await repo.changeEmailAndRelinkSubscriptions(
      'old@example.com',
      'new@example.com'
    );

    expect(await linkedEmailOf('old@example.com')).toBe('new@example.com');
  });

  it('leaves subscriptions of other addresses alone', async () => {
    await database('subscriptions').insert({
      email: 'someone@example.com',
      linked_email: 'other@example.com',
    });

    await repo.changeEmailAndRelinkSubscriptions(
      'old@example.com',
      'new@example.com'
    );

    expect(await linkedEmailOf('someone@example.com')).toBe(
      'other@example.com'
    );
  });

  it("moves the live linked subscription when the user's own one has lapsed", async () => {
    await database('subscriptions').insert([
      { email: 'old@example.com', linked_email: null, active: false },
      {
        email: 'payer@example.com',
        linked_email: 'old@example.com',
        active: true,
      },
    ]);

    await repo.changeEmailAndRelinkSubscriptions(
      'old@example.com',
      'new@example.com'
    );

    expect(await linkedEmailOf('payer@example.com')).toBe('new@example.com');
    expect(await linkedEmailOf('old@example.com')).toBeNull();
  });

  it('keeps the change going when another subscription already holds the new address', async () => {
    await database('subscriptions').insert([
      { email: 'payer@example.com', linked_email: 'old@example.com' },
      { email: 'stale@example.com', linked_email: 'new@example.com' },
    ]);

    await repo.changeEmailAndRelinkSubscriptions(
      'old@example.com',
      'new@example.com'
    );

    const user = await database('users').first();
    expect(user.email).toBe('new@example.com');
    expect(await linkedEmailOf('payer@example.com')).toBe('old@example.com');
    expect(await linkedEmailOf('stale@example.com')).toBe('new@example.com');
  });

  it('keeps the change going when both rows would claim the new address', async () => {
    await database('subscriptions').insert([
      { email: 'old@example.com', linked_email: null },
      { email: 'payer@example.com', linked_email: 'old@example.com' },
    ]);

    await repo.changeEmailAndRelinkSubscriptions(
      'old@example.com',
      'new@example.com'
    );

    const user = await database('users').first();
    expect(user.email).toBe('new@example.com');
    expect(await linkedEmailOf('old@example.com')).toBe('new@example.com');
    expect(await linkedEmailOf('payer@example.com')).toBe('old@example.com');
  });
});
