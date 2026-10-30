import knex, { Knex } from 'knex';

import UsersRepository from './UsersRepository';
import type DeletedUserUsageRepository from './DeletedUserUsageRepository';

const PAST = new Date('2026-01-10T12:00:00.000Z');
const FUTURE = new Date('2099-01-10T12:00:00.000Z');

const OWNER_TABLES = [
  'access_tokens',
  'favorites',
  'jobs',
  'notion_tokens',
  'settings',
  'templates',
  'uploads',
  'blocks',
  'dropbox_uploads',
  'google_drive_uploads',
  'cancellation_feedback',
];

describe('UsersRepository.deleteUser pause-resume warning notices (sqlite integration)', () => {
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
      t.text('email');
      t.integer('cards_used_this_month');
      t.timestamp('cards_month_started_at');
      t.integer('pdf_prints_this_month');
      t.timestamp('prints_month_started_at');
    });
    for (const table of OWNER_TABLES) {
      await database.schema.createTable(table, (t) => {
        t.increments('id').primary();
        t.text('owner');
      });
    }
    await database.schema.createTable('emoji_feedback', (t) => {
      t.increments('id').primary();
      t.text('owner');
      t.text('email');
    });
    await database.schema.createTable('feedback', (t) => {
      t.increments('id').primary();
      t.text('email');
    });
    await database.schema.createTable(
      'abandoned_checkout_recovery_emails',
      (t) => {
        t.increments('id').primary();
        t.text('user_email');
      }
    );
    await database.schema.createTable('subscriptions', (t) => {
      t.increments('id').primary();
      t.text('email').unique();
      t.text('linked_email');
    });
    await database.schema.createTable('pause_resume_warning_notices', (t) => {
      t.increments('id').primary();
      t.text('subscription_email').notNullable();
      t.timestamp('resumes_at').notNullable();
      t.unique(['subscription_email', 'resumes_at']);
    });
    const tombstones = {
      snapshot: async () => undefined,
    } as unknown as DeletedUserUsageRepository;
    repo = new UsersRepository(database, tombstones);
  });

  afterEach(async () => {
    await database.destroy();
  });

  async function seedUser(email: string): Promise<string> {
    const [{ id }] = await database('users')
      .insert({ email, cards_used_this_month: 0, pdf_prints_this_month: 0 })
      .returning('id');
    return String(id);
  }

  async function remainingNoticeKeys(): Promise<string[]> {
    const rows = await database('pause_resume_warning_notices')
      .select('subscription_email')
      .orderBy('subscription_email');
    return rows.map((row) => row.subscription_email as string);
  }

  it('purges the notice keyed on the account address of a linked subscription with a different payer', async () => {
    const owner = await seedUser('account@example.com');
    await database('subscriptions').insert({
      email: 'payer@example.com',
      linked_email: 'account@example.com',
    });
    await database('pause_resume_warning_notices').insert({
      subscription_email: 'account@example.com',
      resumes_at: FUTURE,
    });

    await repo.deleteUser(owner);

    expect(await remainingNoticeKeys()).toEqual([]);
  });

  it('still purges a past notice keyed on the payer address before notices moved to the recipient', async () => {
    const owner = await seedUser('account@example.com');
    await database('subscriptions').insert({
      email: 'payer@example.com',
      linked_email: 'account@example.com',
    });
    await database('pause_resume_warning_notices').insert({
      subscription_email: 'payer@example.com',
      resumes_at: PAST,
    });

    await repo.deleteUser(owner);

    expect(await remainingNoticeKeys()).toEqual([]);
  });

  it("keeps another account's upcoming claim when that account's address is the deleted user's payer address", async () => {
    const owner = await seedUser('account@example.com');
    await seedUser('other@example.com');
    await database('subscriptions').insert([
      { email: 'other@example.com', linked_email: 'account@example.com' },
      { email: 'third-payer@example.com', linked_email: 'other@example.com' },
    ]);
    await database('pause_resume_warning_notices').insert({
      subscription_email: 'other@example.com',
      resumes_at: FUTURE,
    });

    await repo.deleteUser(owner);

    expect(await remainingNoticeKeys()).toEqual(['other@example.com']);
  });

  it("leaves an unrelated account's notice alone", async () => {
    const owner = await seedUser('account@example.com');
    await database('pause_resume_warning_notices').insert({
      subscription_email: 'someone-else@example.com',
      resumes_at: FUTURE,
    });

    await repo.deleteUser(owner);

    expect(await remainingNoticeKeys()).toEqual(['someone-else@example.com']);
  });
});
