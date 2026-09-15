import knex, { Knex } from 'knex';
import { createAiCreditReaders } from './createAiCreditReaders';

const NOW = new Date('2026-05-12T00:00:00.000Z');

async function createSchema(db: Knex): Promise<void> {
  await db.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.text('email').notNullable();
    t.boolean('patreon').defaultTo(false);
    t.boolean('ankify_access').defaultTo(false);
  });
  await db.schema.createTable('subscriptions', (t) => {
    t.increments('id').primary();
    t.text('email');
    t.text('linked_email');
    t.boolean('active').defaultTo(false);
    t.text('payload');
  });
  await db.schema.createTable('user_passes', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.text('kind').notNullable();
    t.timestamp('expires_at').notNullable();
  });
  await db.schema.createTable('ai_credit_grants', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable();
    t.integer('amount_credits').notNullable();
    t.timestamp('expires_at').notNullable();
  });
}

function subPayload(unitAmount: number): string {
  return JSON.stringify({ items: { data: [{ price: { unit_amount: unitAmount } }] } });
}

describe('createAiCreditReaders', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await createSchema(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('reads plan inputs from every active subscription row, not one cherry-picked', async () => {
    await db('users').insert({ id: 7, email: 'user@example.com' });
    await db('subscriptions').insert([
      { email: 'user@example.com', active: true, payload: subPayload(200) },
      {
        linked_email: 'user@example.com',
        active: true,
        payload: subPayload(799),
      },
      { email: 'user@example.com', active: false, payload: subPayload(6400) },
    ]);

    const inputs = await createAiCreditReaders(db).getPlanInputs(7, NOW);

    expect(inputs).not.toBeNull();
    const amounts = inputs!.subscriptions
      .map((s) => s.unitAmount)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(amounts).toEqual([200, 799]);
  });

  it('returns null plan inputs for an unknown user', async () => {
    const inputs = await createAiCreditReaders(db).getPlanInputs(999, NOW);
    expect(inputs).toBeNull();
  });

  it('reads only the passes still active at now', async () => {
    await db('users').insert({ id: 7, email: 'user@example.com' });
    await db('user_passes').insert([
      {
        user_id: 7,
        kind: '7d',
        expires_at: new Date('2026-05-20T00:00:00.000Z'),
      },
      {
        user_id: 7,
        kind: '24h',
        expires_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const inputs = await createAiCreditReaders(db).getPlanInputs(7, NOW);
    expect(inputs?.passes.map((p) => p.kind)).toEqual(['7d']);
  });

  it('sums only the unexpired grants through the real grants repository', async () => {
    await db('ai_credit_grants').insert([
      {
        user_id: 7,
        amount_credits: 100,
        expires_at: new Date('2026-06-01T00:00:00.000Z'),
      },
      {
        user_id: 7,
        amount_credits: 50,
        expires_at: new Date('2026-06-01T00:00:00.000Z'),
      },
      {
        user_id: 7,
        amount_credits: 999,
        expires_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const total = await createAiCreditReaders(db).sumActiveCredits(7, NOW);
    expect(total).toBe(150);
  });
});

describe('createAiCreditReaders userCostSince wiring', () => {
  // The usage cost query uses Postgres jsonb casts that better-sqlite3 cannot
  // run (covered by AiUsageMetricsRepository.sql.test.ts), so the real
  // repository is exercised over a stubbed knex builder — the DB edge — rather
  // than by mocking the repository method.
  it('delegates to the real usage repository', async () => {
    const builder = {
      where: () => builder,
      select: () => builder,
      first: async () => ({ cost_usd: '1.25' }),
    };
    const fakeDb = Object.assign(() => builder, {
      raw: () => 'sum',
    }) as unknown as Knex;

    const spend = await createAiCreditReaders(fakeDb).userCostSince(7, NOW);
    expect(spend).toBe(1.25);
  });
});
