import knex, { Knex } from 'knex';

import { LowRatingContextRepository } from './LowRatingContextRepository';

const NOW = new Date('2026-11-02T10:00:00.000Z');
const OWNER = 4242;

async function createSchema(db: Knex): Promise<void> {
  await db.schema.createTable('users', (t) => {
    t.integer('id').primary();
    t.text('email').notNullable();
    t.boolean('patreon').defaultTo(false);
  });
  await db.schema.createTable('subscriptions', (t) => {
    t.increments('id').primary();
    t.text('email');
    t.text('linked_email');
    t.boolean('active').defaultTo(false);
  });
  await db.schema.createTable('jobs', (t) => {
    t.increments('id').primary();
    t.text('owner').notNullable();
    t.text('status');
  });
  await db.schema.createTable('user_passes', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.text('kind').notNullable();
    t.timestamp('expires_at').notNullable();
    t.text('stripe_payment_intent_id').notNullable();
  });
  await db.schema.createTable('uploads', (t) => {
    t.increments('id').primary();
    t.integer('owner').notNullable();
    t.text('key').notNullable();
    t.text('filename');
    t.timestamp('created_at');
  });
}

describe('LowRatingContextRepository.getByOwner', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await createSchema(db);
    await db('users').insert({
      id: OWNER,
      email: 'pass-holder@example.com',
      patreon: false,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('reads the active pass and newest upload of a pass holder with no Notion jobs', async () => {
    await db('user_passes').insert({
      user_id: OWNER,
      kind: '120d',
      expires_at: new Date('2027-03-01T12:00:00.000Z'),
      stripe_payment_intent_id: 'pi_fixture_semester',
    });
    await db('uploads').insert([
      {
        id: 911,
        owner: OWNER,
        key: 'fixture-older.apkg',
        filename: 'fixture-older.apkg',
        created_at: new Date('2026-11-02T09:00:00.000Z'),
      },
      {
        id: 912,
        owner: OWNER,
        key: 'fixture-newest.apkg',
        filename: 'fixture-newest.apkg',
        created_at: new Date('2026-11-02T09:30:00.000Z'),
      },
      {
        id: 913,
        owner: 31000,
        key: 'fixture-someone-else.apkg',
        filename: 'fixture-someone-else.apkg',
        created_at: new Date('2026-11-02T09:45:00.000Z'),
      },
    ]);

    const context = await new LowRatingContextRepository(db).getByOwner(
      OWNER,
      NOW
    );

    expect(context).toEqual({
      email: 'pass-holder@example.com',
      userId: '4242',
      isLifetime: false,
      hasActiveSubscription: false,
      activePass: {
        id: 1,
        user_id: OWNER,
        kind: '120d',
        expires_at: new Date('2027-03-01T12:00:00.000Z'),
        stripe_payment_intent_id: 'pi_fixture_semester',
      },
      latestJobId: null,
      latestJobStatus: null,
      latestUploadId: 912,
      latestUploadAt: new Date('2026-11-02T09:30:00.000Z'),
    });
  });

  it('reads no pass once it has expired and no upload when there is none', async () => {
    await db('user_passes').insert({
      user_id: OWNER,
      kind: '7d',
      expires_at: new Date('2026-10-01T00:00:00.000Z'),
      stripe_payment_intent_id: 'pi_fixture_expired',
    });

    const context = await new LowRatingContextRepository(db).getByOwner(
      OWNER,
      NOW
    );

    expect(context).toMatchObject({
      activePass: null,
      latestUploadId: null,
      latestUploadAt: null,
    });
  });
});
