import knex, { Knex } from 'knex';

import UsersRepository from './UsersRepository';

const SUBSCRIBED = '2026-02-01T00:00:00.000Z';
const SIGNED_UP_LATER = '2026-03-01T00:00:00.000Z';

describe('UsersRepository.getSubscriptionLinkedEmail', () => {
  let database: Knex;
  let repository: UsersRepository;
  let accountId: string;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await database.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
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
    const [id] = await database('users').insert({
      email: 'payer@example.com',
      created_at: SIGNED_UP_LATER,
    });
    accountId = String(id);
    await database('subscriptions').insert({
      email: 'payer@example.com',
      linked_email: 'owner@example.com',
      payload: JSON.stringify({ id: 'sub_1', metadata: {} }),
      created_at: SUBSCRIBED,
    });
    repository = new UsersRepository(database);
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('hides the linked owner from an unverified account on the payer address', async () => {
    await expect(
      repository.getSubscriptionLinkedEmail(accountId)
    ).resolves.toBe(null);
  });

  it('shows the linked owner once the payer address is verified', async () => {
    await database('users')
      .where({ id: accountId })
      .update({ email_verified: true });

    await expect(
      repository.getSubscriptionLinkedEmail(accountId)
    ).resolves.toBe('owner@example.com');
  });
});
