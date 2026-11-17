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
const HOST = '127.0.0.1';
const BINDING = 'magic_link_binding';
const HOST_BINDING = '__Host-magic_link_binding';
const AUTHORIZE_URL =
  '/mcp/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fchatgpt.com%2Fcb&state=s1&code_challenge=abc&code_challenge_method=S256';
const GENERIC_SERVER_ERROR = {
  code: 'unknown',
  message:
    'Something broke on our end. Try again — if it keeps failing, email support@2anki.net.',
};

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

interface StoredCookie {
  name: string;
  value: string;
  path: string;
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) {
    return true;
  }
  return (
    requestPath.startsWith(cookiePath) &&
    (cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/')
  );
}

function defaultPath(requestPath: string): string {
  const lastSlash = requestPath.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : requestPath.slice(0, lastSlash);
}

// Follows the RFC 6265 rules a browser applies on a loopback origin, which
// browsers treat as secure: Path scoping, host-only cookies, cookie prefixes.
class Browser {
  private cookies: StoredCookie[] = [];

  constructor(entries: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(entries)) {
      this.cookies.push({ name, value, path: '/' });
    }
  }

  get(name: string): string | undefined {
    return this.cookies.find((cookie) => cookie.name === name)?.value;
  }

  header(requestPath: string): string {
    return this.cookies
      .filter((cookie) => pathMatches(requestPath, cookie.path))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  absorb(res: Response, requestPath: string) {
    for (const line of res.headers.getSetCookie()) {
      this.store(line, requestPath);
    }
  }

  store(line: string, requestPath: string) {
    const [pair, ...parts] = line.split(';');
    const name = pair.slice(0, pair.indexOf('=')).trim();
    const value = pair.slice(pair.indexOf('=') + 1).trim();
    const attributes = new Map(
      parts.map((part) => {
        const [key, ...rest] = part.trim().split('=');
        return [key.toLowerCase(), rest.join('=')] as const;
      })
    );
    const secure = attributes.has('secure');
    const domain = attributes.get('domain');
    const pathAttribute = attributes.get('path');
    const path = pathAttribute?.startsWith('/')
      ? pathAttribute
      : defaultPath(requestPath);
    if (domain != null && domain.replace(/^\./, '') !== HOST) {
      return;
    }
    if (
      name.startsWith('__Host-') &&
      (!secure || path !== '/' || domain != null)
    ) {
      return;
    }
    this.cookies = this.cookies.filter(
      (cookie) => !(cookie.name === name && cookie.path === path)
    );
    const maxAge = attributes.get('max-age');
    const expires = attributes.get('expires');
    const expired =
      (maxAge != null && Number(maxAge) <= 0) ||
      (expires != null && Date.parse(expires) <= Date.now());
    if (!expired) {
      this.cookies.push({ name, value, path });
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
  vi.stubEnv('NODE_ENV', 'test');
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
  app.set('trust proxy', 1);
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
  base = `http://${HOST}:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await holder.db?.destroy();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function send(
  browser: Browser,
  target: string,
  init: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<Response> {
  const pathname = new URL(target, base).pathname;
  const res = await fetch(`${base}${target}`, {
    method: init.method ?? 'GET',
    headers: { cookie: browser.header(pathname), ...init.headers },
    body: init.body,
  });
  browser.absorb(res, pathname);
  return res;
}

const sentTokens = (): string[] =>
  (holder.sendMagicLinkEmail?.mock.calls ?? []).map(([, token]) => token);

function requestLink(
  browser: Browser,
  email = EMAIL,
  body: Record<string, string> = {},
  headers: Record<string, string> = {
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
  }
): Promise<Response> {
  const payload = { email, ...body };
  return send(browser, '/api/users/magic-link', {
    method: 'POST',
    headers,
    body:
      headers['content-type'] === 'application/json'
        ? JSON.stringify(payload)
        : new URLSearchParams(payload).toString(),
  });
}

async function issueLink(browser: Browser, email = EMAIL): Promise<string> {
  await requestLink(browser, email);
  const tokens = sentTokens();
  return tokens[tokens.length - 1];
}

function openLink(
  browser: Browser,
  token: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    query?: string;
  } = {}
): Promise<Response> {
  return send(browser, `/api/users/magic/${token}${options.query ?? ''}`, {
    method: options.method,
    headers: options.headers,
  });
}

function confirm(
  browser: Browser,
  body: Record<string, unknown>,
  headers: Record<string, string> = {
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
  }
): Promise<Response> {
  return send(browser, '/api/users/magic/confirm', {
    method: 'POST',
    headers,
    body:
      headers['content-type'] === 'application/json'
        ? JSON.stringify(body)
        : new URLSearchParams(body as Record<string, string>).toString(),
  });
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

const bindingLine = (res: Response, name = BINDING) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`)) ?? '';

const cookieAttributes = (line: string) =>
  line
    .split(';')
    .slice(1)
    .map((part) => part.trim().split('=')[0])
    .sort();

const EXPIRED = {
  message: 'This link is invalid or has expired.',
  code: 'expired',
};

const confirmNeeded = (purpose: string, email: string) => ({
  message: 'Open the link in your email again to finish signing in.',
  confirm: true,
  purpose,
  email,
});

const ALREADY_SIGNED_IN = {
  message: "You're already signed in. Open 2anki to continue.",
  signedIn: true,
};

describe('the test cookie jar', () => {
  it('does not send a cookie outside its Path', () => {
    const browser = new Browser();
    browser.store('scoped=1; Path=/api/users/magic', '/api/users/magic-link');

    expect(browser.header('/api/users/magic/abc')).toBe('scoped=1');
    expect(browser.header('/api/users/magic-link')).toBe('');
  });

  it.each([
    ['without Secure', '__Host-x=1; Path=/'],
    ['with a narrower Path', '__Host-x=1; Secure; Path=/api'],
    ['with a Domain', `__Host-x=1; Secure; Path=/; Domain=${HOST}`],
  ])('refuses a __Host- cookie %s', (_label, line) => {
    const browser = new Browser();
    browser.store(line, '/');

    expect(browser.get('__Host-x')).toBeUndefined();
  });

  it('refuses a cookie for another domain', () => {
    const browser = new Browser();
    browser.store('tossed=1; Path=/; Domain=2anki.net', '/');

    expect(browser.get('tossed')).toBeUndefined();
  });
});

describe('requesting a magic link', () => {
  it('binds the requesting browser with an HttpOnly, Lax cookie on every path', async () => {
    const browser = new Browser();
    const res = await requestLink(browser);

    const binding = bindingLine(res);
    expect(res.status).toBe(200);
    expect(binding).toMatch(/^magic_link_binding=[0-9a-f]{64}; /);
    expect(binding).toMatch(/HttpOnly/);
    expect(binding).toMatch(/SameSite=Lax/);
    expect(binding).toMatch(/Path=\/;/);
    expect(binding).toMatch(/Max-Age=900/);
    expect(binding).not.toMatch(/Domain=/);
    expect(browser.header('/api/users/magic-link')).toMatch(
      /^magic_link_binding=/
    );
  });

  it('never puts the emailed token in the cookie', async () => {
    const browser = new Browser();
    const token = await issueLink(browser);

    expect(browser.get(BINDING)).not.toContain(token.slice(0, 16));
  });

  it('answers a reset request for an unknown address with the same cookie shape', async () => {
    const res = await requestLink(new Browser(), 'nobody@example.com', {
      purpose: 'password_reset',
    });

    expect(sentTokens()).toEqual([]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'ok' });
    expect(cookieNames(res)).toEqual([BINDING]);
    expect(bindingLine(res)).toMatch(/^magic_link_binding=[0-9a-f]{64}; /);
  });

  it('never echoes a binding the caller sends, so an unknown address looks like a known one', async () => {
    const issued = await requestLink(new Browser());
    const known = '0123456789abcdef'.repeat(4);
    const prober = new Browser({ [BINDING]: known });

    const unknown = await requestLink(prober, 'nobody@example.com', {
      purpose: 'password_reset',
    });

    expect(sentTokens()).toHaveLength(1);
    expect(prober.get(BINDING)).toMatch(/^[0-9a-f]{64}$/);
    expect(prober.get(BINDING)).not.toBe(known);
    expect(cookieAttributes(bindingLine(unknown))).toEqual(
      cookieAttributes(bindingLine(issued))
    );
  });

  it('still sends the link for a cross-site JSON request, as before, but sets no binding', async () => {
    const res = await requestLink(
      new Browser(),
      EMAIL,
      {},
      {
        'content-type': 'application/json',
        'sec-fetch-site': 'cross-site',
      }
    );

    expect(res.status).toBe(200);
    expect(sentTokens()).toHaveLength(1);
    expect(cookieNames(res)).toEqual([]);
  });

  it.each([
    ['a form-encoded', 'application/x-www-form-urlencoded'],
    ['a text/plain', 'text/plain'],
  ])(
    'sends nothing and sets no binding for %s body, as before',
    async (_label, contentType) => {
      const res = await requestLink(
        new Browser(),
        EMAIL,
        {},
        {
          'content-type': contentType,
        }
      );

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual(GENERIC_SERVER_ERROR);
      expect(sentTokens()).toEqual([]);
      expect(cookieNames(res)).toEqual([]);
    }
  );
});

describe('opening a magic link in the browser that requested it', () => {
  it('signs in directly and spends the token', async () => {
    const browser = new Browser();
    const token = await issueLink(browser);

    const res = await openLink(browser, token);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ token: expect.any(String) });
    expect(cookieNames(res).sort()).toEqual([BINDING, 'token']);
    expect(browser.get('token')).toBe(body.token);
    expect(browser.get(BINDING)).toBeUndefined();
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

    expect(res.status).toBe(428);
    expect(await res.json()).toMatchObject({ confirm: true });
    expect(await usedAt(first)).toBeNull();
  });
});

describe('in production', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
  });

  it('binds with a Secure __Host- cookie on / with no Domain', async () => {
    const browser = new Browser();
    const res = await requestLink(browser);

    const binding = bindingLine(res, HOST_BINDING);
    expect(binding).toMatch(/^__Host-magic_link_binding=[0-9a-f]{64}; /);
    expect(binding).toMatch(/Secure/);
    expect(binding).toMatch(/Path=\/;/);
    expect(binding).not.toMatch(/Domain=/);
    expect(browser.get(HOST_BINDING)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('signs in directly with the __Host- binding', async () => {
    const browser = new Browser();
    const token = await issueLink(browser);

    const res = await openLink(browser, token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: expect.any(String) });
    expect(browser.get(HOST_BINDING)).toBeUndefined();
  });

  it('ignores a binding sent under the bare name', async () => {
    const requester = new Browser();
    const token = await issueLink(requester);
    const tossed = new Browser({ [BINDING]: requester.get(HOST_BINDING)! });

    const res = await openLink(tossed, token);

    expect(res.status).toBe(428);
    expect(await usedAt(token)).toBeNull();
  });
});

describe('opening a magic link anywhere else', () => {
  it('shows the confirm step without spending the token or signing in', async () => {
    const token = await issueLink(new Browser());
    const elsewhere = new Browser();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await openLink(elsewhere, token);

      expect(res.status).toBe(428);
      expect(await res.json()).toEqual(
        confirmNeeded('login', 'l•••@example.com')
      );
      expect(cookieNames(res)).toEqual([]);
    }
    expect(await usedAt(token)).toBeNull();
    expect(await sessionRows(userId)).toBe(0);
  });

  it('treats a tampered binding cookie as no cookie', async () => {
    const requester = new Browser();
    const token = await issueLink(requester);
    const binding = requester.get(BINDING) ?? '';
    const tampered = new Browser({
      [BINDING]: `${binding.slice(0, -1)}${binding.endsWith('0') ? '1' : '0'}`,
    });

    const res = await openLink(tampered, token);

    expect(res.status).toBe(428);
    expect(await res.json()).toMatchObject({ confirm: true });
    expect(await usedAt(token)).toBeNull();
  });

  it.each([
    ['a garbage value', 'not-a-binding'],
    ['an empty value', ''],
  ])('treats %s in the binding cookie as no cookie', async (_label, value) => {
    const token = await issueLink(new Browser());

    const res = await openLink(new Browser({ [BINDING]: value }), token);

    expect(res.status).toBe(428);
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

    expect(body).toEqual(confirmNeeded('password_reset', 's•••@example.org'));
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

  it('refuses an email-verification token and leaves it unspent', async () => {
    const token = await issueLink(new Browser());
    await holder.db!('magic_tokens').where({ token }).update({
      purpose: 'verify_email',
    });

    const res = await confirm(new Browser(), { token });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(EXPIRED);
    expect(await usedAt(token)).toBeNull();
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

  describe('rate limiting', () => {
    const confirmFrom = (address: string, attempt: number) =>
      confirm(
        new Browser(),
        { token: `guess-${attempt}` },
        {
          'content-type': 'application/json',
          'sec-fetch-site': 'same-origin',
          'x-forwarded-for': address,
        }
      );

    it('counts every address in one IPv6 /64 against one bucket', async () => {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const res = await confirmFrom(`2001:db8:1:1::${attempt + 1}`, attempt);
        statuses.push(res.status);
      }

      const sameNetwork = await confirmFrom('2001:db8:1:1::ffff', 10);
      const otherNetwork = await confirmFrom('2001:db8:2:2::1', 11);

      expect(statuses).toEqual(Array(10).fill(400));
      expect(sameNetwork.status).toBe(429);
      expect(otherNetwork.status).toBe(400);
    });

    it('has no shared cap that many networks together can exhaust', async () => {
      for (let network = 1; network <= 51; network += 1) {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await confirmFrom(`10.0.${network}.1`, attempt);
        }
      }

      const fresh = await confirmFrom('192.0.2.1', 0);

      expect(fresh.status).toBe(400);
    });
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

      expect(bound.status).toBe(428);
      expect(unbound.status).toBe(428);
      expect(cookieNames(bound)).toEqual([]);
      expect(cookieNames(unbound)).toEqual([]);
      expect(await usedAt(token)).toBeNull();
      expect(await sessionRows(userId)).toBe(0);
      expect(requester.get(BINDING)).toMatch(/^[0-9a-f]{64}$/);
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

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ...ALREADY_SIGNED_IN,
      redirect: '/upload',
    });
    expect(cookieNames(res)).toEqual([]);
    expect(await sessionRows(userId)).toBe(sessionsBefore);
  });

  it('sends its owner into the app when they confirm twice', async () => {
    const token = await spentToken();
    const owner = await signedInBrowser(userId);

    const res = await confirm(owner, { token });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(ALREADY_SIGNED_IN);
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

describe('without the hashing secret', () => {
  it('fails closed on open: a generic 500, nothing spent, no session', async () => {
    const requester = new Browser();
    const token = await issueLink(requester);
    vi.stubEnv('THE_HASHING_SECRET', undefined);

    const bound = await openLink(requester, token);
    const unbound = await openLink(new Browser(), token);

    expect(bound.status).toBe(500);
    expect(await bound.json()).toEqual(GENERIC_SERVER_ERROR);
    expect(unbound.status).toBe(500);
    expect(cookieNames(bound)).toEqual([]);
    expect(await usedAt(token)).toBeNull();
    expect(await sessionRows(userId)).toBe(0);
  });

  it('fails closed on confirm: a generic 500, nothing spent, no session', async () => {
    const token = await issueLink(new Browser());
    vi.stubEnv('THE_HASHING_SECRET', undefined);

    const res = await confirm(new Browser(), { token });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(GENERIC_SERVER_ERROR);
    expect(cookieNames(res)).toEqual([]);
    expect(await usedAt(token)).toBeNull();
    expect(await sessionRows(userId)).toBe(0);
  });

  it('fails closed with an empty secret too', async () => {
    const token = await issueLink(new Browser());
    vi.stubEnv('THE_HASHING_SECRET', '');

    const opened = await openLink(new Browser(), token);
    const confirmed = await confirm(new Browser(), { token });

    expect(opened.status).toBe(500);
    expect(confirmed.status).toBe(500);
    expect(await usedAt(token)).toBeNull();
  });

  it('fails closed on request: a generic 500, no link sent, no binding', async () => {
    vi.stubEnv('THE_HASHING_SECRET', undefined);

    const res = await requestLink(new Browser());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(GENERIC_SERVER_ERROR);
    expect(sentTokens()).toEqual([]);
    expect(cookieNames(res)).toEqual([]);
  });
});

describe('what the magic-link log records', () => {
  it('never turns a sign-in into an error when the log line fails', async () => {
    const requester = new Browser();
    const direct = await issueLink(requester);
    const other = await issueLink(new Browser());
    vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('log sink unavailable');
    });

    const opened = await openLink(requester, direct);
    const confirmed = await confirm(new Browser(), { token: other });

    expect(opened.status).toBe(200);
    expect(await opened.json()).toEqual({ token: expect.any(String) });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ token: expect.any(String) });
    expect(await sessionRows(userId)).toBe(2);
  });

  it('counts confirm shown, confirmed, and signed in directly without tokens or cookie values', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const requester = new Browser();
    const direct = await issueLink(requester);
    const binding = requester.get(BINDING) ?? '';
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
