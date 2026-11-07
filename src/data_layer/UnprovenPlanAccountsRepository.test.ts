import knex, { Knex } from 'knex';

import {
  buildCandidateEmailsQuery,
  UnprovenPlanAccountsRepository,
} from './UnprovenPlanAccountsRepository';

describe('buildCandidateEmailsQuery SQL', () => {
  it('joins on the normalized payer address and filters unverified live plans', () => {
    const sql = buildCandidateEmailsQuery(knex({ client: 'pg' })).toString();

    expect(sql).toContain(
      'lower(trim(users.email)) = lower(trim(subscriptions.email))'
    );
    expect(sql).toContain('"users"."email_verified" = false');
    expect(sql).toContain('"subscriptions"."active" = true');
  });
});

describe('UnprovenPlanAccountsRepository', () => {
  let database: Knex;

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
    });
    await database.schema.createTable('subscriptions', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
      t.text('linked_email').nullable();
      t.boolean('active').notNullable().defaultTo(false);
    });
    await database('users').insert([
      { email: 'unlinked@x.test', email_verified: false },
      { email: 'second-account@x.test', email_verified: false },
      { email: 'verified@x.test', email_verified: true },
      { email: 'ended@x.test', email_verified: false },
    ]);
    await database('subscriptions').insert([
      { email: 'unlinked@x.test', linked_email: null, active: true },
      {
        email: 'second-account@x.test',
        linked_email: 'owner@x.test',
        active: true,
      },
      { email: 'verified@x.test', linked_email: null, active: true },
      { email: 'ended@x.test', linked_email: null, active: false },
    ]);
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('returns only unverified accounts on a live plan linked to nobody else', async () => {
    const emails = await new UnprovenPlanAccountsRepository(
      database
    ).findCandidateEmails();

    expect(emails).toEqual(['unlinked@x.test']);
  });
});
