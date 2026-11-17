import { vi, type Mock } from 'vitest';
import type { Knex } from 'knex';

const holder = vi.hoisted(() => ({ db: null as Knex | null }));

vi.mock('../data_layer', () => ({
  getDatabase: vi.fn(() => holder.db),
}));

vi.mock('../services/EmailService/EmailService', () => ({
  getDefaultEmailService: vi.fn(() => ({})),
}));

vi.mock('../services/events/track', () => ({ track: vi.fn() }));

vi.mock('../services/observability/instrumentedAxios', () => ({
  default: { post: vi.fn(), get: vi.fn() },
}));

vi.mock('../controllers/IndexController/getIndexFileContents', () => ({
  getIndexFileContents: () =>
    '<!doctype html><html lang="en"><head><title>2anki</title></head><body><div id="root"></div></body></html>',
}));

import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import knex from 'knex';

import UserRouter from './UserRouter';
import DefaultRouter from './DefaultRouter';
import { noindexAuthPages } from './middleware/noindexAuthPages';
import instrumentedAxios from '../services/observability/instrumentedAxios';
import { __resetGoogleJwksCacheForTests } from '../services/AuthenticationService';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CLIENT_ID = 'google-client';
const KID = 'register-test-key';
const EMAIL = 'learner@example.com';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicJwk = publicKey.export({ format: 'jwk' });

const googleIdToken = () =>
  jwt.sign(
    {
      iss: 'https://accounts.google.com',
      aud: GOOGLE_CLIENT_ID,
      sub: 'google-sub-1',
      email: EMAIL,
      email_verified: true,
      name: 'Learner',
    },
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { algorithm: 'RS256', header: { alg: 'RS256', kid: KID } }
  );

async function makeDatabase(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await db.schema.createTable('users', (t) => {
    t.increments('id');
    t.string('name');
    t.string('email');
    t.string('password');
    t.boolean('email_verified');
    t.timestamp('created_at').defaultTo(db.fn.now());
    t.timestamp('last_login_at');
  });
  await db.schema.createTable('access_tokens', (t) => {
    t.increments('id');
    t.string('token', 1024);
    t.integer('owner');
    t.timestamp('created_at').defaultTo(db.fn.now());
  });
  await db.schema.createTable('oauth_identities', (t) => {
    t.increments('id');
    t.string('provider');
    t.string('subject');
    t.integer('user_id');
    t.string('refresh_token');
    t.unique(['provider', 'subject']);
  });
  await db.schema.createTable('notion_tokens', (t) => {
    t.increments('id');
    t.integer('owner').unique();
    t.string('token');
  });
  return db;
}

async function listen(app: express.Express): Promise<{
  server: http.Server;
  base: string;
}> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, base };
}

function appWith(...routers: express.RequestHandler[]): express.Express {
  const app = express();
  app.use(cookieParser());
  app.use(noindexAuthPages);
  for (const router of routers) {
    app.use(router);
  }
  return app;
}

const cookiePair = (setCookies: string[], name: string) =>
  (setCookies.find((c) => c.startsWith(`${name}=`)) ?? '').split(';')[0];

const loginReturnCookie = (res: Response) =>
  res.headers.getSetCookie().find((c) => c.startsWith('login_return=')) ?? null;

let server: http.Server;
let base: string;

beforeEach(async () => {
  vi.stubEnv('SECRET', 'route-test-secret');
  vi.stubEnv('THE_HASHING_SECRET', 'route-test-hashing-secret');
  vi.stubEnv('GOOGLE_CLIENT_ID', GOOGLE_CLIENT_ID);
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-secret');
  vi.stubEnv('GOOGLE_REDIRECT_URI', 'https://2anki.net/api/users/auth/google');
  __resetGoogleJwksCacheForTests();
  (instrumentedAxios.get as Mock).mockReset().mockResolvedValue({
    data: {
      keys: [{ kid: KID, kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e }],
    },
  });
  (instrumentedAxios.post as Mock)
    .mockReset()
    .mockImplementation(async (_label: string, url: string) => {
      if (url === GOOGLE_TOKEN_URL) {
        return { data: { id_token: googleIdToken() } };
      }
      throw new Error(`unexpected POST ${url}`);
    });
  holder.db = await makeDatabase();
  await holder.db('users').insert({
    name: 'Learner',
    email: EMAIL,
    password: 'hash',
    email_verified: true,
  });
  ({ server, base } = await listen(appWith(UserRouter(), DefaultRouter())));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await holder.db?.destroy();
  vi.unstubAllEnvs();
});

const get = (path: string, cookie = '', origin = base) =>
  fetch(`${origin}${path}`, {
    headers: { cookie, 'user-agent': 'Mozilla/5.0' },
    redirect: 'manual',
  });

describe('GET /register', () => {
  it('remembers /print in the login return cookie', async () => {
    const res = await get('/register?redirect=/print');

    expect(res.status).toBe(200);
    expect(loginReturnCookie(res)).toMatch(
      /^login_return=%2Fprint; Max-Age=600; Path=\/; Expires=.*; HttpOnly; Secure; SameSite=None$/
    );
  });

  it.each(['https://evil.com/print', '//evil.com', '/not-a-section'])(
    'never remembers a target outside the allowlist: %s',
    async (target) => {
      const res = await get(`/register?redirect=${encodeURIComponent(target)}`);

      expect(res.status).toBe(200);
      expect(loginReturnCookie(res)).toBeNull();
    }
  );

  it('sends a Google sign-in started from the register page back to /print', async () => {
    const register = await get('/register?redirect=/print');
    const returnCookie = cookiePair(
      register.headers.getSetCookie(),
      'login_return'
    );
    const init = await get('/api/users/auth/google/init', returnCookie);
    const state =
      new URL(init.headers.get('location') ?? '').searchParams.get('state') ??
      '';
    const stateCookie = cookiePair(
      init.headers.getSetCookie(),
      'google_login_state'
    );

    const callback = await get(
      `/api/users/auth/google?code=provider-code&state=${encodeURIComponent(state)}`,
      `${returnCookie}; ${stateCookie}`
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get('location')).toBe('/print');
  });

  it.each(['/Register', '/REGISTER'])(
    'leaves %s to the app route: same status, no return cookie',
    async (path) => {
      const before = await listen(appWith(DefaultRouter()));
      try {
        const expected = await get(`${path}?redirect=/print`, '', before.base);
        const actual = await get(`${path}?redirect=/print`);

        expect(actual.status).toBe(expected.status);
        expect(actual.status).toBe(404);
        expect(actual.headers.get('set-cookie')).toBeNull();
        expect(await actual.text()).toBe(await expected.text());
      } finally {
        await new Promise<void>((resolve) =>
          before.server.close(() => resolve())
        );
      }
    }
  );

  it.each([
    ['a signed-out visitor', ''],
    ['a visitor with a session cookie', 'token=session-cookie'],
  ])(
    'serves %s the same page, status and headers as the app route without a redirect',
    async (_visitor, cookie) => {
      const before = await listen(appWith(DefaultRouter()));
      try {
        const expected = await get('/register', cookie, before.base);
        const actual = await get('/register', cookie);

        expect(actual.status).toBe(expected.status);
        expect(actual.status).toBe(200);
        for (const header of [
          'content-type',
          'cache-control',
          'x-robots-tag',
          'set-cookie',
        ]) {
          expect(actual.headers.get(header)).toBe(expected.headers.get(header));
        }
        expect(actual.headers.get('x-robots-tag')).toBe('noindex');
        expect(await actual.text()).toBe(await expected.text());
      } finally {
        await new Promise<void>((resolve) =>
          before.server.close(() => resolve())
        );
      }
    }
  );
});
