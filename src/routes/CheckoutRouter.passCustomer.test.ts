import { vi } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import knex, { Knex } from 'knex';

const mockSessionCreate = vi.fn();
const mockCustomerCreate = vi.fn();

vi.mock('../lib/integrations/stripe', () => ({
  getStripe: () => ({
    checkout: { sessions: { create: mockSessionCreate } },
    prices: { search: async () => ({ data: [] }) },
    customers: { create: mockCustomerCreate, del: vi.fn() },
  }),
}));

const mockDatabase = vi.hoisted(() => ({
  instance: null as unknown as Knex,
}));

vi.mock('../data_layer', () => ({
  getDatabase: () => mockDatabase.instance,
}));

const TABLES = ['users', 'access_tokens', 'subscriptions', 'user_passes'];

const SECRET = 'pass-customer-test-secret';
const OWNER = 42;
const ACCOUNT_EMAIL = 'buyer@example.com';

async function createSchema(database: Knex) {
  for (const table of TABLES) {
    await database.schema.dropTableIfExists(table);
  }
  await database.schema.createTable('users', (t) => {
    t.integer('id').primary();
    t.text('email');
    t.boolean('patreon').defaultTo(false);
    t.text('stripe_customer_id').nullable();
  });
  await database.schema.createTable('access_tokens', (t) => {
    t.integer('owner').notNullable();
    t.text('token').notNullable();
    t.timestamp('created_at').defaultTo(database.fn.now());
  });
  await database.schema.createTable('subscriptions', (t) => {
    t.text('email');
    t.text('linked_email');
    t.boolean('active');
  });
  await database.schema.createTable('user_passes', (t) => {
    t.increments('id');
    t.integer('user_id');
    t.text('kind');
    t.timestamp('expires_at');
    t.text('stripe_payment_intent_id');
  });
}

async function signIn(database: Knex): Promise<string> {
  const token = jwt.sign({ userId: OWNER }, SECRET);
  await database('access_tokens').insert({ owner: OWNER, token });
  return token;
}

async function buildServer() {
  const { default: CheckoutRouter } = await import('./CheckoutRouter');
  const app = express();
  app.use(cookieParser());
  app.use(CheckoutRouter());
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

const firstSessionParams = () => mockSessionCreate.mock.calls[0][0];

describe('CheckoutRouter — pass checkout reaches Stripe with the account', () => {
  let server: http.Server;
  let url: string;
  let database: Knex;

  const buyPass = (kind: string, token?: string) =>
    fetch(`${url}/api/checkout/pass/${kind}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token == null ? {} : { cookie: `token=${token}` }),
      },
      body: JSON.stringify({ surface: 'pricing' }),
    });

  beforeAll(async () => {
    vi.stubEnv('SECRET', SECRET);
    vi.stubEnv('THE_HASHING_SECRET', 'pass-customer-test-hash-secret');
    vi.stubEnv('PASS_24H_PRICE_ID', 'price_24h_test');
    vi.stubEnv('PASS_7D_PRICE_ID', 'price_7d_test');
    vi.stubEnv('PASS_120D_PRICE_ID', 'price_120d_test');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    mockDatabase.instance = database;
    ({ server, url } = await buildServer());
  });

  afterAll(async () => {
    server.close();
    const { resetEventsSinkForTesting } =
      await import('../services/events/eventsSinkInstance');
    resetEventsSinkForTesting();
    await database.destroy();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await createSchema(database);
    await database('users').insert({ id: OWNER, email: ACCOUNT_EMAIL });
    mockSessionCreate.mockReset();
    mockSessionCreate.mockResolvedValue({
      url: 'https://checkout.stripe.com/c/pay/test',
    });
    mockCustomerCreate.mockReset();
    mockCustomerCreate.mockResolvedValue({ id: 'cus_created_for_account' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['24h', '7d', '120d'])(
    'creates the account customer once and passes it for a signed-in %s pass',
    async (kind) => {
      const token = await signIn(database);

      const res = await buyPass(kind, token);

      expect(res.status).toBe(200);
      expect(mockCustomerCreate).toHaveBeenCalledWith({
        email: ACCOUNT_EMAIL,
        metadata: { user_id: String(OWNER) },
      });
      expect(firstSessionParams()).toMatchObject({
        customer: 'cus_created_for_account',
        metadata: { pass_kind: kind, user_id: String(OWNER) },
      });
      expect(firstSessionParams().customer_email).toBeUndefined();
      expect(firstSessionParams().custom_fields).toBeUndefined();
      const stored = await database('users')
        .where({ id: OWNER })
        .first('stripe_customer_id');
      expect(stored.stripe_customer_id).toBe('cus_created_for_account');
    }
  );

  it('reuses the customer already linked to the account', async () => {
    await database('users')
      .where({ id: OWNER })
      .update({ stripe_customer_id: 'cus_existing' });
    const token = await signIn(database);

    await buyPass('24h', token);

    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(firstSessionParams().customer).toBe('cus_existing');
  });

  it('replaces a linked customer that Stripe no longer has and retries the session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await database('users')
      .where({ id: OWNER })
      .update({ stripe_customer_id: 'cus_deleted_in_stripe' });
    mockSessionCreate.mockRejectedValueOnce(
      Object.assign(new Error('No such customer'), {
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        param: 'customer',
      })
    );
    const token = await signIn(database);

    const res = await buyPass('120d', token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: 'https://checkout.stripe.com/c/pay/test',
    });
    expect(mockSessionCreate).toHaveBeenCalledTimes(2);
    expect(firstSessionParams().customer).toBe('cus_deleted_in_stripe');
    expect(mockSessionCreate.mock.calls[1][0]).toMatchObject({
      customer: 'cus_created_for_account',
      metadata: { pass_kind: '120d', user_id: String(OWNER) },
    });
    expect(mockCustomerCreate).toHaveBeenCalledTimes(1);
    const stored = await database('users')
      .where({ id: OWNER })
      .first('stripe_customer_id');
    expect(stored.stripe_customer_id).toBe('cus_created_for_account');
    expect(warn).toHaveBeenCalledWith('checkout.session.customer_refreshed', {
      error_code: 'resource_missing',
    });
  });

  it('prefills the account email when the customer cannot be resolved', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockCustomerCreate.mockRejectedValue(
      Object.assign(new Error('Stripe is down'), {
        type: 'StripeAPIError',
      })
    );
    const token = await signIn(database);

    const res = await buyPass('7d', token);

    expect(res.status).toBe(200);
    expect(firstSessionParams()).toMatchObject({
      customer_email: ACCOUNT_EMAIL,
      metadata: { user_id: String(OWNER) },
    });
    expect(firstSessionParams().customer).toBeUndefined();
    expect(error).toHaveBeenCalledWith('checkout.customer_resolve_failed', {
      user_id: OWNER,
      error_name: 'Error',
      error_code: undefined,
    });
    error.mockRestore();
  });

  it.each([
    ['no session cookie', undefined],
    ['a session cookie that does not verify', 'not-a-valid-jwt'],
  ])('keeps the anonymous checkout for %s', async (_case, token) => {
    const res = await buyPass('24h', token);

    expect(res.status).toBe(200);
    expect(mockCustomerCreate).not.toHaveBeenCalled();
    const params = firstSessionParams();
    expect(params.customer).toBeUndefined();
    expect(params.customer_email).toBeUndefined();
    expect(params.metadata).toMatchObject({
      pass_kind: '24h',
      pass_anonymous: '1',
    });
    expect(params.metadata.user_id).toBeUndefined();
    expect(params.custom_fields).toEqual([
      expect.objectContaining({ key: 'account_email', optional: true }),
    ]);
  });

  it('answers 409 to a pass holder before creating any customer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
    await database('user_passes').insert({
      user_id: OWNER,
      kind: '7d',
      expires_at: new Date('2026-10-05T00:00:00.000Z'),
      stripe_payment_intent_id: 'pi_held',
    });
    const token = await signIn(database);

    const res = await buyPass('24h', token);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'pass_still_active',
      expiresAt: '2026-10-05T00:00:00.000Z',
    });
    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });
});
