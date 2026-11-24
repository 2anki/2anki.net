import { vi } from 'vitest';
import type { Knex } from 'knex';

const holder = vi.hoisted(() => ({ db: null as Knex | null }));

vi.mock('../data_layer', () => ({
  getDatabase: vi.fn(() => holder.db),
}));

vi.mock('../services/EmailService/EmailService', () => ({
  getDefaultEmailService: vi.fn(() => ({})),
}));

vi.mock('../services/events/track', () => ({ track: vi.fn() }));

import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';
import knex from 'knex';

import UserRouter from './UserRouter';

const PASSWORD = crypto.randomUUID();
const STORED_HASH = 'hash';

async function makeDatabase(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await db.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('name');
    t.string('email').unique();
    t.string('password');
    t.boolean('email_verified');
    t.string('signup_origin');
    t.text('signup_attribution');
    t.string('signup_country');
    t.integer('cards_used_this_month');
    t.timestamp('cards_month_started_at');
    t.integer('pdf_prints_this_month');
    t.timestamp('prints_month_started_at');
    t.timestamp('created_at').defaultTo(db.fn.now());
    t.timestamp('last_login_at');
  });
  await db.schema.createTable('deleted_user_usage', (t) => {
    t.string('email_sha256').primary();
    t.integer('cards_used_this_month');
    t.timestamp('cards_month_started_at');
    t.integer('pdf_prints_this_month');
    t.timestamp('prints_month_started_at');
  });
  await db.schema.createTable('access_tokens', (t) => {
    t.increments('id');
    t.string('token', 1024);
    t.integer('owner');
    t.timestamp('created_at').defaultTo(db.fn.now());
  });
  await db.schema.createTable('notion_tokens', (t) => {
    t.increments('id');
    t.integer('owner').unique();
    t.string('token');
  });
  return db;
}

let server: http.Server;
let base: string;

beforeEach(async () => {
  vi.stubEnv('SECRET', 'route-test-secret');
  vi.stubEnv('THE_HASHING_SECRET', 'route-test-hashing-secret');
  holder.db = await makeDatabase();
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(UserRouter());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await holder.db?.destroy();
  vi.unstubAllEnvs();
});

const post = (path: string, body: Record<string, string>) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const register = (email: string) =>
  post('/api/users/register', { name: '', email, password: PASSWORD });

const storedEmails = async () =>
  (await holder.db!('users').select('email').orderBy('id')).map(
    (row: { email: string }) => row.email
  );

describe('POST /api/users/register', () => {
  it.each([
    ['digits only', '4791234567'],
    ['a bare username', 'studyhard'],
    ['a domain with no dot', 'name@gmail'],
    ['two at signs', 'a@b@example.com'],
    ['a space inside', 'name @example.com'],
    ['a display name wrapper', 'Name <name@example.com>'],
  ])('refuses %s with a 400 and creates no account', async (_shape, email) => {
    const res = await register(email);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message: 'Enter a full email address, like name@example.com.',
      code: 'invalid_email',
    });
    expect(await storedEmails()).toEqual([]);
  });

  it('stores the trimmed lowercase address and signs the new account in', async () => {
    const res = await register('  Learner.New@Example.COM ');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: expect.any(String) });
    expect(await storedEmails()).toEqual(['learner.new@example.com']);
  });

  it('refuses a second account for a mailbox stored in a different case', async () => {
    await holder.db!('users').insert({
      name: 'Existing',
      email: 'Existing.Learner@Example.com',
      password: STORED_HASH,
      email_verified: true,
    });

    const res = await register(' existing.learner@example.com ');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      message:
        'An account with this email already exists. Try logging in instead.',
    });
    expect(await storedEmails()).toEqual(['Existing.Learner@Example.com']);
  });

  it('still signs in an existing account whose stored email is not an address', async () => {
    await register('first.learner@example.com');
    const created = await holder.db!('users').first();
    await holder.db!('users')
      .where({ id: created.id })
      .update({ email: '4791234567' });

    const res = await post('/api/users/login', {
      email: '4791234567',
      password: PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ token: expect.any(String) });
  });
});
