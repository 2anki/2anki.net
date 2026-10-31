import knex, { Knex } from 'knex';

import UsersRepository from './UsersRepository';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const LATER = new Date('2026-10-01T13:00:00.000Z');

interface SubscriptionRow {
  email: string;
  linked_email: string | null;
}

type EmailChange = (
  repo: UsersRepository,
  database: Knex,
  userId: number
) => Promise<void>;

const confirmedChange: EmailChange = async (repo, database, userId) => {
  const [{ id: tokenId }] = await database('email_change_tokens')
    .insert({ user_id: userId, expires_at: LATER })
    .returning('id');
  const result = await repo.applyEmailChange({
    userId,
    newEmail: 'New@Example.com',
    tokenId: tokenId as number,
    now: NOW,
  });
  expect(result).toEqual({ ok: true });
};

const opsChange: EmailChange = async (repo) => {
  await repo.changeEmailAndRelinkSubscriptions(
    'Old@Example.com',
    'New@Example.com'
  );
};

describe.each([
  ['a user-confirmed email change', confirmedChange],
  ['an ops email change', opsChange],
] as const)(
  'UsersRepository relinks subscriptions on %s (sqlite integration)',
  (_label, changeEmail) => {
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
        t.text('linked_email').unique();
      });
      await database.schema.createTable('email_change_tokens', (t) => {
        t.increments('id').primary();
        t.integer('user_id').notNullable();
        t.timestamp('expires_at').notNullable();
        t.timestamp('consumed_at').nullable();
      });
      await database.schema.createTable('magic_tokens', (t) => {
        t.increments('id').primary();
        t.integer('owner').notNullable();
        t.timestamp('used_at').nullable();
      });
      await database.schema.createTable('pause_resume_warning_notices', (t) => {
        t.increments('id').primary();
        t.text('subscription_email').notNullable();
        t.timestamp('resumes_at').notNullable();
      });
      repo = new UsersRepository(database);
    });

    afterEach(async () => {
      await database.destroy();
    });

    async function seedUser(email: string): Promise<number> {
      const [{ id }] = await database('users')
        .insert({ email })
        .returning('id');
      return id as number;
    }

    async function subscriptions(): Promise<SubscriptionRow[]> {
      return database('subscriptions')
        .select('email', 'linked_email')
        .orderBy('email');
    }

    it('moves a subscription another payer linked to the old address', async () => {
      const userId = await seedUser('old@example.com');
      await database('subscriptions').insert({
        email: 'payer@example.com',
        linked_email: 'Old@Example.com',
      });

      await changeEmail(repo, database, userId);

      expect(await subscriptions()).toEqual([
        { email: 'payer@example.com', linked_email: 'new@example.com' },
      ]);
    });

    it('moves an unlinked subscription the user pays for with the old address', async () => {
      const userId = await seedUser('old@example.com');
      await database('subscriptions').insert({
        email: 'old@example.com',
        linked_email: null,
      });

      await changeEmail(repo, database, userId);

      expect(await subscriptions()).toEqual([
        { email: 'old@example.com', linked_email: 'new@example.com' },
      ]);
    });

    it("leaves a subscription the user only pays for on another account's link", async () => {
      const userId = await seedUser('old@example.com');
      await database('subscriptions').insert({
        email: 'old@example.com',
        linked_email: 'friend@example.com',
      });

      await changeEmail(repo, database, userId);

      expect(await subscriptions()).toEqual([
        { email: 'old@example.com', linked_email: 'friend@example.com' },
      ]);
    });

    it("leaves other accounts' subscriptions alone", async () => {
      const userId = await seedUser('old@example.com');
      await database('subscriptions').insert([
        { email: 'someone@example.com', linked_email: null },
        { email: 'payer@example.com', linked_email: 'friend@example.com' },
      ]);

      await changeEmail(repo, database, userId);

      expect(await subscriptions()).toEqual([
        { email: 'payer@example.com', linked_email: 'friend@example.com' },
        { email: 'someone@example.com', linked_email: null },
      ]);
    });

    it("keeps the pause notice of the account the user's payment reaches", async () => {
      const userId = await seedUser('old@example.com');
      await database('subscriptions').insert({
        email: 'old@example.com',
        linked_email: 'friend@example.com',
      });
      await database('pause_resume_warning_notices').insert({
        subscription_email: 'friend@example.com',
        resumes_at: LATER,
      });

      await changeEmail(repo, database, userId);

      expect(
        await database('pause_resume_warning_notices').pluck(
          'subscription_email'
        )
      ).toEqual(['friend@example.com']);
    });
  }
);
