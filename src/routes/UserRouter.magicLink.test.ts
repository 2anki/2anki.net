import { vi, type Mock } from 'vitest';
import type { Knex } from 'knex';

const holder = vi.hoisted(() => ({
  db: null as Knex | null,
  sendMagicLinkEmail: null as Mock | null,
}));

vi.mock('../data_layer', () => ({
  getDatabase: vi.fn(() => holder.db),
}));

vi.mock('../services/EmailService/EmailService', () => ({
  getDefaultEmailService: vi.fn(() => ({
    sendMagicLinkEmail: (...args: unknown[]) =>
      holder.sendMagicLinkEmail?.(...args),
  })),
}));

vi.mock('../services/events/track', () => ({ track: vi.fn() }));

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import knex from 'knex';

import UserRouter from './UserRouter';
import ErrorHandler from './middleware/ErrorHandler';

const EMAIL = 'learner@example.com';
const OTHER_EMAIL = 'someone.else@example.org';
const AUTHORIZE_URL =
  '/mcp/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcb&state=s1&code_challenge=abc&code_challenge_method=S256';

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
    t.string('signup_origin');
    t.text('signup_attribution');
    t.string('reset_token');
    t.timestamp('reset_token_expires_at');
    t.timestamp('reset_token_used_at');
    t.timestamp('created_at').defaultTo(db.fn.now());
    t.timestamp('last_login_at');
  });
  await db.schema.createTable('access_tokens', (t) => {
    t.increments('id');
    t.string('token', 1024);
    t.integer('owner');
    t.timestamp('created_at').defaultTo(db.fn.now());
  });
  await db.schema.createTable('magic_tokens', (t) => {
    t.increments('id');
    t.string('token', 128).unique();
    t.integer('owner');
    t.string('purpose', 20);
    t.timestamp('created_at').defaultTo(db.fn.now());
    t.timestamp('expires_at');
    t.timestamp('used_at').nullable();
  });
  await db.schema.createTable('subscriptions', (t) => {
    t.increments('id');
    t.string('email');
    t.string('linked_email');
    t.boolean('active');
    t.text('payload');
    t.timestamp('created_at').defaultTo(db.fn.now());
  });
  await db.schema.createTable('deleted_user_usage', (t) => {
    t.string('email_sha256').primary();
  });
  return db;
}

class Browser {
  private readonly jar = new Map<string, string>();

  constructor(entries: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(entries)) {
      this.jar.set(name, value);
    }
  }

  get(name: string): string | undefined {
    return this.jar.get(name);
  }

  set(name: string, value: string) {
    this.jar.set(name, value);
  }

  header(): string {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const name = pair.slice(0, pair.indexOf('='));
      const value = pair.slice(pair.indexOf('=') + 1);
      if (value === '' || /Expires=Thu, 01 Jan 1970/.test(line)) {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }
  }
}

let server: http.Server;
let base: string;
let userId: number;
let otherUserId: number;

beforeEach(async () => {
  vi.stubEnv('SECRET', 'route-test-secret');
  vi.stubEnv('THE_HASHING_SECRET', 'route-test-hashing-secret');
  holder.sendMagicLinkEmail = vi.fn().mockResolvedValue({ suppressed: false });
  holder.db = await makeDatabase();
  [userId] = await holder.db('users').insert({
    name: 'Learner',
    email: EMAIL,
    password: 'hash',
    email_verified: true,
  });
  [otherUserId] = await holder.db('users').insert({
    name: 'Other',
    email: OTHER_EMAIL,
    password: 'hash',
    email_verified: true,
  });

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(UserRouter());
  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      next: () => void
    ) => {
      if (err) {
        ErrorHandler(res, req, err);
      } else {
        next();
      }
    }
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await holder.db?.destroy();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const sentTokens = (): string[] =>
  (holder.sendMagicLinkEmail?.mock.calls ?? []).map(([, token]) => token);

async function requestLink(
  browser: Browser,
  email = EMAIL,
  body: Record<string, string> = {}
): Promise<Response> {
  const res = await fetch(`${base}/api/users/magic-link`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      cookie: browser.header(),
    },
    body: JSON.stringify({ email, ...body }),
  });
  browser.absorb(res);
  return res;
}

async function issueLink(browser: Browser, email = EMAIL): Promise<string> {
  await requestLink(browser, email);
  const tokens = sentTokens();
  return tokens[tokens.length - 1];
}

async function openLink(
  browser: Browser,
  token: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    query?: string;
  } = {}
): Promise<Response> {
  const res = await fetch(
    `${base}/api/users/magic/${token}${options.query ?? ''}`,
    {
      method: options.method ?? 'GET',
      headers: { cookie: browser.header(), ...options.headers },
    }
  );
  browser.absorb(res);
  return res;
}

async function confirm(
  browser: Browser,
  body: Record<string, unknown>,
  headers: Record<string, string> = {
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
  }
): Promise<Response> {
  const res = await fetch(`${base}/api/users/magic/confirm`, {
    method: 'POST',
    headers: { cookie: browser.header(), ...headers },
    body:
      headers['content-type'] === 'application/json'
        ? JSON.stringify(body)
        : new URLSearchParams(body as Record<string, string>).toString(),
  });
  browser.absorb(res);
  return res;
}

async function usedAt(token: string): Promise<unknown> {
  const row = await holder.db!('magic_tokens').where({ token }).first();
  return row?.used_at ?? null;
}

async function sessionRows(owner: number): Promise<number> {
  const rows = await holder.db!('access_tokens').where({ owner });
  return rows.length;
}

async function signedInBrowser(owner: number): Promise<Browser> {
  const token = jwt.sign({ userId: owner }, 'route-test-secret');
  await holder.db!('access_tokens').insert({ token, owner });
  return new Browser({ token });
}

const cookieNames = (res: Response) =>
  res.headers.getSetCookie().map((c) => c.split('=')[0]);

const EXPIRED = {
  message: 'This link is invalid or has expired.',
  code: 'expired',
};

describe('requesting a magic link', () => {
  it('binds the requesting browser with an HttpOnly, Lax cookie scoped to the magic-link API', async () => {
    const res = await requestLink(new Browser());

    const binding = res.headers
      .getSetCookie()
      .find((c) => c.startsWith('magic_link_binding='));
    expect(res.status).toBe(200);
    expect(binding).toMatch(/^magic_link_binding=[0-9a-f]{64}; /);
    expect(binding).toMatch(/HttpOnly/);
    expect(binding).toMatch(/SameSite=Lax/);
    expect(binding).toMatch(/Path=\/api\/users\/magic;/);
    expect(binding).toMatch(/Max-Age=900/);
  });

  it('never puts the emailed token in the cookie', async () => {
    const browser = new Browser();
    const token = await issueLink(browser);

    expect(browser.get('magic_link_binding')).not.toContain(token.slice(0, 16));
  });

  it('answers a reset request for an unknown address with the same cookie shape', async () => {
    const res = await requestLink(new Browser(), 'nobody@example.com', {
      purpose: 'password_reset',
    });

    expect(sentTokens()).toEqual([]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'ok' });
    expect(cookieNames(res)).toEqual(['magic_link_binding']);
    expect(res.headers.getSetCookie()[0]).toMatch(
      /^magic_link_binding=[0-9a-f]{64}; /
    );
  });
});

describe('opening a magic link in the browser that requested it', () => {
  it('signs in directly and spends the token', async () => {
    const browser = new Browser();
    const token = await issueLink(browser);

    const res = await openLink(browser, token);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ token: expect.any(String) });
    expect(cookieNames(res).sort()).toEqual(['magic_link_binding', 'token']);
    expect(browser.get('token')).toBe(body.token);
    expect(browser.get('magic_link_binding')).toBeUndefined();
    expect(await usedAt(token)).not.toBeNull();
    expect(await sessionRows(userId)).toBe(1);
  });

  it('signs in a brand-new account created by the link request', async () => {
    const browser = new Browser();
    const token = await issueLink(browser, 'newcomer@example.com');
    const newUser = await holder.db!('users')
      .where({ email: 'newcomer@example.com' })
      .first();

    const res = await openLink(browser, token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: expect.any(String) });
    expect(await sessionRows(newUser.id)).toBe(1);
  });

  it('returns a connector to the authorize screen it came from', async () => {
    const browser = new Browser({
      mcp_login_return: encodeURIComponent(AUTHORIZE_URL),
    });
    const token = await issueLink(browser);

    const res = await openLink(browser, token);

    expect(await res.json()).toEqual({
      token: expect.any(String),
      redirect: AUTHORIZE_URL,
    });
  });

  it('keeps a safe redirect from the emailed link', async () => {
    const browser = new Browser();
    const token = await issueLink(browser);

    const res = await openLink(browser, token, {
      query: '?redirect=%2Fpricing%3Fref%3Dmcp',
    });

    expect(await res.json()).toEqual({
      token: expect.any(String),
      redirect: '/pricing?ref=mcp',
    });
  });

  it('only skips the click for the most recently requested link', async () => {
    const browser = new Browser();
    const first = await issueLink(browser);
    await issueLink(browser);

    const res = await openLink(browser, first);

    expect(await res.json()).toMatchObject({ confirm: true });
    expect(await usedAt(first)).toBeNull();
  });
});

describe('opening a magic link anywhere else', () => {
  it('shows the confirm step without spending the token or signing in', async () => {
    const token = await issueLink(new Browser());
    const elsewhere = new Browser();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await openLink(elsewhere, token);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        confirm: true,
        purpose: 'login',
        email: 'l•••@example.com',
      });
      expect(cookieNames(res)).toEqual([]);
    }
    expect(await usedAt(token)).toBeNull();
    expect(await sessionRows(userId)).toBe(0);
  });

  it('treats a tampered binding cookie as no cookie', async () => {
    const requester = new Browser();
    const token = await issueLink(requester);
    const binding = requester.get('magic_link_binding') ?? '';
    const tampered = new Browser({
      magic_link_binding: `${binding.slice(0, -1)}${binding.endsWith('0') ? '1' : '0'}`,
    });

    const res = await openLink(tampered, token);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ confirm: true });
    expect(await usedAt(token)).toBeNull();
  });

  it.each([
    ['a garbage value', 'not-a-binding'],
    ['an empty value', ''],
  ])('treats %s in the binding cookie as no cookie', async (_label, value) => {
    const token = await issueLink(new Browser());

    const res = await openLink(
      new Browser({ magic_link_binding: value }),
      token
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ confirm: true });
  });

  it('refuses an email-verification token without spending it', async () => {
    const token = await issueLink(new Browser());
    await holder.db!('magic_tokens').where({ token }).update({
      purpose: 'verify_email',
    });

    const res = await openLink(new Browser(), token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(EXPIRED);
    expect(await usedAt(token)).toBeNull();
  });

  it('masks the address for a reset link too', async () => {
    const token = await issueLink(new Browser(), OTHER_EMAIL);
    await holder.db!('magic_tokens').where({ token }).update({
      purpose: 'password_reset',
    });

    const res = await openLink(new Browser(), token);
    const body = await res.json();

    expect(body).toEqual({
      confirm: true,
      purpose: 'password_reset',
      email: 's•••@example.org',
    });
    expect(JSON.stringify(body)).not.toContain('someone');
  });
});

describe('confirming a magic link', () => {
  it('signs in and spends the token, and a second confirm fails', async () => {
    const token = await issueLink(new Browser());
    const elsewhere = new Browser();

    const first = await confirm(elsewhere, { token });
    const firstBody = await first.json();

    expect(first.status).toBe(200);
    expect(firstBody).toEqual({ token: expect.any(String) });
    expect(cookieNames(first)).toEqual(['token']);
    expect(await usedAt(token)).not.toBeNull();

    const stranger = new Browser();
    const second = await confirm(stranger, { token });

    expect(second.status).toBe(400);
    expect(await second.json()).toEqual(EXPIRED);
    expect(cookieNames(second)).toEqual([]);
    expect(await sessionRows(userId)).toBe(1);
  });

  it('carries the redirect from the link through the confirm step', async () => {
    const token = await issueLink(new Browser());

    const res = await confirm(new Browser(), { token, redirect: '/upload' });

    expect(await res.json()).toEqual({
      token: expect.any(String),
      redirect: '/upload',
    });
  });

  it('returns a connector to the authorize screen when the confirming browser started one', async () => {
    const token = await issueLink(new Browser());
    const connector = new Browser({
      mcp_login_return: encodeURIComponent(AUTHORIZE_URL),
    });

    const res = await confirm(connector, { token });

    expect(await res.json()).toEqual({
      token: expect.any(String),
      redirect: AUTHORIZE_URL,
    });
    expect(connector.get('mcp_login_return')).toBeUndefined();
  });

  it('turns a reset link into a reset token', async () => {
    const token = await issueLink(new Browser());
    await holder.db!('magic_tokens').where({ token }).update({
      purpose: 'password_reset',
    });

    const res = await confirm(new Browser(), { token });
    const body = await res.json();
    const user = await holder.db!('users').where({ id: userId }).first();

    expect(body).toEqual({
      purpose: 'password_reset',
      reset_token: expect.any(String),
    });
    expect(user.reset_token).toBe(body.reset_token);
    expect(cookieNames(res)).toEqual([]);
  });

  it.each([
    [
      'a form post',
      {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'cross-site',
      },
    ],
    [
      'a cross-site JSON request',
      { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
    ],
    [
      'a same-site JSON request',
      { 'content-type': 'application/json', 'sec-fetch-site': 'same-site' },
    ],
    ['a text/plain post', { 'content-type': 'text/plain' }],
  ])('refuses %s without spending the token', async (_label, headers) => {
    const token = await issueLink(new Browser());

    const res = await confirm(new Browser(), { token }, headers);

    expect(res.status).toBe(403);
    expect(cookieNames(res)).toEqual([]);
    expect(await usedAt(token)).toBeNull();
  });

  it('asks for the token when the body has none', async () => {
    const res = await confirm(new Browser(), {});

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: 'Token is required' });
  });

  it('rate-limits confirm attempts per address', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const res = await confirm(new Browser(), { token: `guess-${attempt}` });
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(400));
    expect(statuses[10]).toBe(429);
  });
});

describe('HEAD requests and prefetches', () => {
  it.each([
    ['a HEAD request', { method: 'HEAD' }],
    ['Purpose: prefetch', { headers: { purpose: 'prefetch' } }],
    ['Sec-Purpose: prefetch', { headers: { 'sec-purpose': 'prefetch' } }],
    ['X-Moz: prefetch', { headers: { 'x-moz': 'prefetch' } }],
  ])(
    'never spend the token: %s, with or without the binding',
    async (_label, options) => {
      const requester = new Browser();
      const token = await issueLink(requester);

      const bound = await openLink(requester, token, options);
      const unbound = await openLink(new Browser(), token, options);

      expect(bound.status).toBe(200);
      expect(unbound.status).toBe(200);
      expect(cookieNames(bound)).toEqual([]);
      expect(cookieNames(unbound)).toEqual([]);
      expect(await usedAt(token)).toBeNull();
      expect(await sessionRows(userId)).toBe(0);
      expect(requester.get('magic_link_binding')).toMatch(/^[0-9a-f]{64}$/);
    }
  );

  it('leaves the link working for the person after a prefetch', async () => {
    const requester = new Browser();
    const token = await issueLink(requester);
    await openLink(requester, token, {
      headers: { 'sec-purpose': 'prefetch' },
    });

    const res = await openLink(requester, token);

    expect(await res.json()).toEqual({ token: expect.any(String) });
  });
});

describe('a magic link that was already used', () => {
  async function spentToken(): Promise<string> {
    const token = await issueLink(new Browser());
    await confirm(new Browser(), { token });
    return token;
  }

  it('sends its own signed-in owner into the app without a new session', async () => {
    const token = await spentToken();
    const owner = await signedInBrowser(userId);
    const sessionsBefore = await sessionRows(userId);

    const res = await openLink(owner, token, { query: '?redirect=%2Fupload' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: true, redirect: '/upload' });
    expect(cookieNames(res)).toEqual([]);
    expect(await sessionRows(userId)).toBe(sessionsBefore);
  });

  it('sends its owner into the app when they confirm twice', async () => {
    const token = await spentToken();
    const owner = await signedInBrowser(userId);

    const res = await confirm(owner, { token });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: true });
    expect(cookieNames(res)).toEqual([]);
  });

  it('shows the expired page to a signed-out browser', async () => {
    const token = await spentToken();

    const res = await openLink(new Browser(), token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(EXPIRED);
  });

  it('shows the expired page to a browser signed in as someone else and leaves that session alone', async () => {
    const token = await spentToken();
    const someoneElse = await signedInBrowser(otherUserId);
    const session = someoneElse.get('token');

    const res = await openLink(someoneElse, token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(EXPIRED);
    expect(cookieNames(res)).toEqual([]);
    expect(someoneElse.get('token')).toBe(session);
    expect(await sessionRows(otherUserId)).toBe(1);
    expect(await sessionRows(userId)).toBe(1);
  });
});

describe('a magic link past its lifetime', () => {
  async function expiredToken(browser: Browser): Promise<string> {
    const token = await issueLink(browser);
    await holder.db!('magic_tokens')
      .where({ token })
      .update({ expires_at: new Date(Date.now() - 1000) });
    return token;
  }

  it('shows the expired page on open, even in the requesting browser', async () => {
    const requester = new Browser();
    const token = await expiredToken(requester);

    const res = await openLink(requester, token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(EXPIRED);
    expect(cookieNames(res)).toEqual([]);
  });

  it('shows the expired page on confirm', async () => {
    const token = await expiredToken(new Browser());

    const res = await confirm(new Browser(), { token });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(EXPIRED);
    expect(await usedAt(token)).toBeNull();
  });

  it('shows the expired page to its signed-in owner', async () => {
    const token = await expiredToken(new Browser());

    const res = await openLink(await signedInBrowser(userId), token);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(EXPIRED);
  });
});

describe('what the magic-link log records', () => {
  it('counts confirm shown, confirmed, and signed in directly without tokens or cookie values', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const requester = new Browser();
    const direct = await issueLink(requester);
    const binding = requester.get('magic_link_binding') ?? '';
    await openLink(requester, direct);
    const other = await issueLink(new Browser());
    await openLink(new Browser(), other);
    await confirm(new Browser(), { token: other });

    const outcomes = info.mock.calls
      .filter(([key]) => key === 'password_reset.magic_link')
      .map(([, fields]) => (fields as { outcome: string }).outcome);
    const logged = JSON.stringify(info.mock.calls);

    expect(outcomes).toEqual([
      'sent',
      'signed_in_direct',
      'sent',
      'confirm_shown',
      'confirmed',
    ]);
    expect(logged).not.toContain(direct);
    expect(logged).not.toContain(other);
    expect(binding).toMatch(/^[0-9a-f]{64}$/);
    expect(logged).not.toContain(binding);
  });
});
