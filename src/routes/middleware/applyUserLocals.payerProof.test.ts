import knex, { Knex } from 'knex';
import type { Response } from 'express';

import { applyUserLocals } from './configureUserLocal';
import AuthenticationService, {
  UserWithOwner,
} from '../../services/AuthenticationService';
import TokenRepository from '../../data_layer/TokenRepository';
import UsersRepository from '../../data_layer/UsersRepository';
import { InMemoryUserPassRepository } from '../../data_layer/UserPassRepository';

const PAYER = 'payer@example.com';
const NOW = new Date('2026-06-01T00:00:00.000Z');

describe('applyUserLocals, the web, iOS and MCP session path', () => {
  let database: Knex;
  let authService: AuthenticationService;

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
      t.boolean('active').notNullable().defaultTo(false);
      t.text('payload').nullable();
      t.text('created_at').nullable();
    });
    await database('users').insert({
      id: 7,
      email: PAYER,
      created_at: '2026-03-01T00:00:00.000Z',
    });
    await database('subscriptions').insert({
      email: PAYER,
      linked_email: 'owner@example.com',
      active: true,
      payload: JSON.stringify({ id: 'sub_1', metadata: {} }),
      created_at: '2026-02-01T00:00:00.000Z',
    });
    authService = new AuthenticationService(
      new TokenRepository(database),
      new UsersRepository(database)
    );
  });

  afterEach(async () => {
    await database.destroy();
  });

  const locals = async (
    passes = new InMemoryUserPassRepository(),
    patreon = false
  ) => {
    const res = { locals: {} } as unknown as Response;
    await applyUserLocals(
      res,
      { owner: 7, email: PAYER, patreon } as unknown as UserWithOwner,
      authService,
      database,
      NOW,
      passes
    );
    return res.locals;
  };

  it('reads an unproven account as free', async () => {
    expect(await locals()).toMatchObject({
      subscriber: false,
      planSource: null,
    });
  });

  it('keeps a pass held by an unproven account', async () => {
    const passes = new InMemoryUserPassRepository();
    passes.seed({
      user_id: 7,
      kind: '7d',
      expires_at: new Date('2026-06-08T00:00:00.000Z'),
      stripe_payment_intent_id: 'pi_1',
    } as Parameters<InMemoryUserPassRepository['seed']>[0]);

    expect(await locals(passes)).toMatchObject({
      subscriber: true,
      passKind: '7d',
      planSource: null,
    });
  });

  it('reads a lifetime holder on the row as lifetime', async () => {
    expect(await locals(undefined, true)).toMatchObject({
      subscriber: false,
      planSource: 'lifetime',
      patreon: true,
    });
  });

  it('reads an Apple plan on the row as Apple', async () => {
    const passes = new InMemoryUserPassRepository();
    passes.seed({
      user_id: 7,
      kind: 'unlimited',
      expires_at: new Date('2026-06-08T00:00:00.000Z'),
      stripe_payment_intent_id: 'apple:txn_1',
    } as Parameters<InMemoryUserPassRepository['seed']>[0]);

    expect(await locals(passes)).toMatchObject({
      subscriber: true,
      planSource: 'apple',
    });
  });

  it('reads the plan once the address is verified', async () => {
    await database('users').where({ id: 7 }).update({ email_verified: true });

    expect(await locals()).toMatchObject({
      subscriber: true,
      planSource: 'stripe',
    });
  });
});
