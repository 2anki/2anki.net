import { vi, type Mock } from 'vitest';
import type { Knex } from 'knex';

const holder = vi.hoisted(() => ({
  db: null as Knex | null,
  failingTable: null as string | null,
}));

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

import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import knex from 'knex';

import UserRouter from './UserRouter';
import NotionRouter from './NotionRouter';
import ErrorHandler from './middleware/ErrorHandler';
import instrumentedAxios from '../services/observability/instrumentedAxios';
import {
  __resetAppleJwksCacheForTests,
  __resetGoogleJwksCacheForTests,
  __resetMicrosoftJwksCacheForTests,
} from '../services/AuthenticationService';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MICROSOFT_TOKEN_URL =
  'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token';
const GOOGLE_CLIENT_ID = 'google-client';
const MICROSOFT_CLIENT_ID = 'microsoft-client';
const KID = 'provider-test-key';
const EMAIL = 'learner@example.com';
const LINK_PREVIEW_AGENT =
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)';
const GENERIC_SERVER_ERROR = {
  code: 'unknown',
  message:
    'Something broke on our end. Try again — if it keeps failing, email support@2anki.net.',
};

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicJwk = publicKey.export({ format: 'jwk' });

const signIdToken = (claims: Record<string, unknown>) =>
  jwt.sign(claims, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
    algorithm: 'RS256',
    header: { alg: 'RS256', kid: KID },
  });

const googleIdToken = () =>
  signIdToken({
    iss: 'https://accounts.google.com',
    aud: GOOGLE_CLIENT_ID,
    sub: 'google-sub-1',
    email: EMAIL,
    email_verified: true,
    name: 'Learner',
  });

const microsoftIdToken = () =>
  signIdToken({
    iss: 'https://login.microsoftonline.com/tenant-1/v2.0',
    aud: MICROSOFT_CLIENT_ID,
    sub: 'microsoft-sub-1',
    email: EMAIL,
    email_verified: true,
    name: 'Learner',
  });

const databaseUnavailable = () =>
  Object.assign(
    new Error('terminating connection due to administrator command'),
    { code: '57P01' }
  );

async function makeDatabase(): Promise<Knex> {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    wrapIdentifier: (value, origImpl) => {
      if (value === holder.failingTable) {
        throw databaseUnavailable();
      }
      return origImpl(value);
    },
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
    t.string('token_type');
    t.string('bot_id');
    t.string('workspace_name');
    t.string('workspace_icon');
    t.string('workspace_id');
    t.text('notion_owner');
    t.timestamp('invalidated_at');
    t.timestamp('reconnect_email_sent_at');
  });
  await db.schema.createTable('user_visible_errors', (t) => {
    t.increments('id');
    t.integer('user_id');
    t.string('surface');
    t.string('code');
    t.text('context');
    t.timestamp('occurred_at').defaultTo(db.fn.now());
  });
  return db;
}

interface ErrorRow {
  user_id: number | null;
  surface: string;
  code: string;
  context: Record<string, unknown>;
}

async function errorRows(): Promise<ErrorRow[]> {
  const rows = await holder.db!('user_visible_errors')
    .select('user_id', 'surface', 'code', 'context')
    .orderBy('id');
  return rows.map((row) => ({
    ...row,
    context: JSON.parse(row.context ?? 'null'),
  }));
}

const exchangesWith = (url: string) =>
  (instrumentedAxios.post as Mock).mock.calls.filter(([, u]) => u === url);

const cookiePair = (setCookies: string[], name: string) =>
  (setCookies.find((c) => c.startsWith(`${name}=`)) ?? '').split(';')[0];

const setsSession = (res: Response) =>
  res.headers.getSetCookie().some((c) => /^token=[^;]+/.test(c));

const cookieNames = (res: Response) =>
  res.headers.getSetCookie().map((c) => c.split('=')[0]);

const clearsOnly = (res: Response, stateCookie: string) => {
  const setCookies = res.headers.getSetCookie();
  expect(cookieNames(res)).toEqual([stateCookie]);
  expect(setCookies[0]).toMatch(
    new RegExp(`^${stateCookie}=;.*Expires=Thu, 01 Jan 1970`)
  );
};

let server: http.Server;
let base: string;
let userId: number;

beforeEach(async () => {
  vi.stubEnv('SECRET', 'route-test-secret');
  vi.stubEnv('THE_HASHING_SECRET', 'route-test-hashing-secret');
  vi.stubEnv('GOOGLE_CLIENT_ID', GOOGLE_CLIENT_ID);
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'google-secret');
  vi.stubEnv('GOOGLE_REDIRECT_URI', 'https://2anki.net/api/users/auth/google');
  vi.stubEnv('MICROSOFT_CLIENT_ID', MICROSOFT_CLIENT_ID);
  vi.stubEnv('MICROSOFT_CLIENT_SECRET', 'microsoft-secret');
  vi.stubEnv(
    'MICROSOFT_REDIRECT_URI',
    'https://2anki.net/api/users/auth/microsoft'
  );
  vi.stubEnv('NOTION_CLIENT_ID', 'notion-client');
  vi.stubEnv('NOTION_CLIENT_SECRET', 'notion-secret');
  vi.stubEnv('NOTION_REDIRECT_URI', 'https://2anki.net/api/notion/connect');
  __resetGoogleJwksCacheForTests();
  __resetMicrosoftJwksCacheForTests();
  holder.failingTable = null;
  (instrumentedAxios.post as Mock).mockReset();
  (instrumentedAxios.get as Mock).mockReset();
  (instrumentedAxios.get as Mock).mockResolvedValue({
    data: {
      keys: [{ kid: KID, kty: publicJwk.kty, n: publicJwk.n, e: publicJwk.e }],
    },
  });
  (instrumentedAxios.post as Mock).mockImplementation(async (_l, url) => {
    if (url === GOOGLE_TOKEN_URL) {
      return { data: { id_token: googleIdToken() } };
    }
    if (url === MICROSOFT_TOKEN_URL) {
      return { data: { id_token: microsoftIdToken() } };
    }
    if (url === NOTION_TOKEN_URL) {
      return {
        data: {
          access_token: 'notion-access',
          token_type: 'bearer',
          bot_id: 'bot-1',
          workspace_name: 'Workspace',
          workspace_id: 'ws-1',
          owner: { user: { name: 'Learner', person: { email: EMAIL } } },
        },
      };
    }
    throw new Error(`unexpected POST ${url}`);
  });

  holder.db = await makeDatabase();
  [userId] = await holder.db('users').insert({
    name: 'Learner',
    email: EMAIL,
    password: 'hash',
    email_verified: true,
  });

  const app = express();
  app.use(cookieParser());
  app.use(UserRouter());
  app.use(NotionRouter());
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
  holder.failingTable = null;
  await holder.db?.destroy();
  vi.unstubAllEnvs();
});

const get = (path: string, cookie: string, userAgent = 'Mozilla/5.0') =>
  fetch(`${base}${path}`, {
    headers: { cookie, 'user-agent': userAgent },
    redirect: 'manual',
  });

const providers = [
  {
    provider: 'Google',
    init: '/api/users/auth/google/init',
    callback: '/api/users/auth/google',
    stateCookie: 'google_login_state',
    tokenUrl: GOOGLE_TOKEN_URL,
    surface: 'oauth_google',
    expired: '/login?error=google_signin_expired',
    landing: '/upload',
  },
  {
    provider: 'Microsoft',
    init: '/api/users/auth/microsoft/init',
    callback: '/api/users/auth/microsoft',
    stateCookie: 'microsoft_login_state',
    tokenUrl: MICROSOFT_TOKEN_URL,
    surface: 'oauth_microsoft',
    expired: '/login?error=microsoft_signin_expired',
    landing: '/upload',
  },
  {
    provider: 'Notion',
    init: '/api/users/auth/notion/init',
    callback: '/api/users/auth/notion',
    stateCookie: 'notion_login_state',
    tokenUrl: NOTION_TOKEN_URL,
    surface: 'oauth_notion',
    expired: '/login?error=notion_signin_expired',
    landing: '/notion',
  },
];

describe.each(providers)(
  'the $provider sign-in callback',
  ({ init, callback, stateCookie, tokenUrl, surface, expired, landing }) => {
    async function startSignIn() {
      const res = await get(init, '');
      const state =
        new URL(res.headers.get('location') ?? '').searchParams.get('state') ??
        '';
      const cookie = cookiePair(res.headers.getSetCookie(), stateCookie);
      return { state, cookie };
    }

    const callbackUrl = (state: string, extra = '') =>
      `${callback}?code=provider-code&state=${encodeURIComponent(state)}${extra}`;

    async function signIn() {
      const { state, cookie } = await startSignIn();
      const first = await get(callbackUrl(state), cookie);
      const session = cookiePair(first.headers.getSetCookie(), 'token');
      return { state, cookie, first, session };
    }

    it('signs in on the first callback with the state it was handed', async () => {
      const { first } = await signIn();

      expect(first.status).toBe(302);
      expect(first.headers.get('location')).toBe(landing);
      expect(setsSession(first)).toBe(true);
      expect(
        first.headers
          .getSetCookie()
          .some((c) => c.startsWith(`${stateCookie}=;`))
      ).toBe(true);
      expect(exchangesWith(tokenUrl)).toHaveLength(1);
      expect(await errorRows()).toEqual([]);
    });

    it('sends a repeated callback from a signed-in browser to the signed-in landing without exchanging the code again', async () => {
      const { state, session } = await signIn();

      const repeat = await get(callbackUrl(state), session);

      expect(repeat.status).toBe(302);
      expect(repeat.headers.get('location')).toBe(landing);
      clearsOnly(repeat, stateCookie);
      expect(exchangesWith(tokenUrl)).toHaveLength(1);
      expect(await holder.db!('access_tokens').count('* as n')).toEqual([
        { n: 1 },
      ]);
      expect(await errorRows()).toEqual([
        {
          user_id: userId,
          surface,
          code: 'oauth_repeat_callback',
          context: {
            alreadySignedIn: true,
            hadStateCookie: false,
            hadStateParam: true,
            userAgent: 'Mozilla/5.0',
          },
        },
      ]);
    });

    it('keeps a repeated callback on the signed-in landing even when it names a redirect', async () => {
      const { state, session } = await signIn();

      const repeat = await get(
        callbackUrl(state, '&redirect=%2Fpricing'),
        session
      );

      expect(repeat.headers.get('location')).toBe(landing);
      clearsOnly(repeat, stateCookie);
    });

    it('refuses a callback with no state cookie and no session, and points to a fresh sign-in', async () => {
      const { state } = await startSignIn();

      const res = await get(callbackUrl(state), '');

      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(expired);
      clearsOnly(res, stateCookie);
      expect(exchangesWith(tokenUrl)).toHaveLength(0);
      expect(await holder.db!('access_tokens').count('* as n')).toEqual([
        { n: 0 },
      ]);
      expect(await errorRows()).toEqual([
        {
          user_id: null,
          surface,
          code: 'oauth_state_mismatch',
          context: {
            alreadySignedIn: false,
            hadStateCookie: false,
            hadStateParam: true,
            userAgent: 'Mozilla/5.0',
          },
        },
      ]);
    });

    it('treats a session cookie that does not verify as signed out', async () => {
      const { state } = await startSignIn();

      const res = await get(callbackUrl(state), 'token=not-a-session');

      expect(res.headers.get('location')).toBe(expired);
      clearsOnly(res, stateCookie);
      expect(exchangesWith(tokenUrl)).toHaveLength(0);
      expect(await errorRows()).toMatchObject([
        { code: 'oauth_state_mismatch', context: { alreadySignedIn: false } },
      ]);
    });

    it('refuses a link-preview fetch of the callback without writing a visible-error row', async () => {
      const { state } = await startSignIn();

      const res = await get(callbackUrl(state), '', LINK_PREVIEW_AGENT);

      expect(res.headers.get('location')).toBe(expired);
      clearsOnly(res, stateCookie);
      expect(exchangesWith(tokenUrl)).toHaveLength(0);
      expect(await errorRows()).toEqual([]);
    });

    it('refuses a state that differs from the cookie for a signed-out browser', async () => {
      const { cookie } = await startSignIn();
      const { state: otherState } = await startSignIn();

      const res = await get(callbackUrl(otherState), cookie);

      expect(res.headers.get('location')).toBe(expired);
      clearsOnly(res, stateCookie);
      expect(exchangesWith(tokenUrl)).toHaveLength(0);
      expect(await errorRows()).toMatchObject([
        {
          user_id: null,
          code: 'oauth_state_mismatch',
          context: { alreadySignedIn: false, hadStateCookie: true },
        },
      ]);
    });

    it('sends a signed-in browser with a state that differs from the cookie to the signed-in landing, exchanges nothing and records a mismatch', async () => {
      const { session } = await signIn();
      const { cookie } = await startSignIn();
      const { state: otherState } = await startSignIn();

      const res = await get(callbackUrl(otherState), `${session}; ${cookie}`);

      expect(res.headers.get('location')).toBe(landing);
      clearsOnly(res, stateCookie);
      expect(exchangesWith(tokenUrl)).toHaveLength(1);
      expect(await errorRows()).toEqual([
        {
          user_id: userId,
          surface,
          code: 'oauth_state_mismatch',
          context: {
            alreadySignedIn: true,
            hadStateCookie: true,
            hadStateParam: true,
            userAgent: 'Mozilla/5.0',
          },
        },
      ]);
    });

    it('answers a refused callback with the generic 500 when the session lookup fails, exchanging nothing', async () => {
      const { state, session } = await signIn();
      holder.failingTable = 'access_tokens';

      const res = await get(callbackUrl(state), session);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual(GENERIC_SERVER_ERROR);
      expect(setsSession(res)).toBe(false);
      expect(cookieNames(res)).toEqual([stateCookie]);
      expect(exchangesWith(tokenUrl)).toHaveLength(1);
    });

    it('never stores the state or the code in the visible-error row', async () => {
      const { state, session } = await signIn();

      await get(callbackUrl(state), session);
      await get(callbackUrl(state), '');

      const stored = JSON.stringify(await errorRows());
      expect(stored).not.toContain(state.replace(/^login:/, ''));
      expect(stored).not.toContain('provider-code');
      expect(stored).not.toContain(session.split('=')[1]);
    });
  }
);

describe('the Microsoft sign-in callback on a repeat', () => {
  it('links the Microsoft identity once and leaves it alone on the repeated callback', async () => {
    const init = await get('/api/users/auth/microsoft/init', '');
    const state =
      new URL(init.headers.get('location') ?? '').searchParams.get('state') ??
      '';
    const stateCookie = cookiePair(
      init.headers.getSetCookie(),
      'microsoft_login_state'
    );
    const url = `/api/users/auth/microsoft?code=provider-code&state=${encodeURIComponent(state)}`;
    const first = await get(url, stateCookie);
    const session = cookiePair(first.headers.getSetCookie(), 'token');
    const linked = await holder.db!('oauth_identities').select('*');

    await get(url, session);

    expect(linked).toEqual([
      expect.objectContaining({
        provider: 'microsoft',
        subject: 'microsoft-sub-1',
        user_id: userId,
      }),
    ]);
    expect(await holder.db!('oauth_identities').select('*')).toEqual(linked);
  });
});

describe('the Notion sign-in callback on a repeat', () => {
  it('saves the workspace once and leaves it alone on the repeated callback', async () => {
    const init = await get('/api/users/auth/notion/init', '');
    const state =
      new URL(init.headers.get('location') ?? '').searchParams.get('state') ??
      '';
    const stateCookie = cookiePair(
      init.headers.getSetCookie(),
      'notion_login_state'
    );
    const url = `/api/users/auth/notion?code=provider-code&state=${encodeURIComponent(state)}`;
    const first = await get(url, stateCookie);
    const session = cookiePair(first.headers.getSetCookie(), 'token');
    const saved = await holder.db!('notion_tokens').select('*');

    await get(url, session);

    expect(saved).toHaveLength(1);
    expect(await holder.db!('notion_tokens').select('*')).toEqual(saved);
    expect(exchangesWith(NOTION_TOKEN_URL)).toHaveLength(1);
  });
});

describe('a Notion sign-in returning through /api/notion/connect', () => {
  async function startNotionSignIn() {
    const init = await get('/api/users/auth/notion/init', '');
    const state =
      new URL(init.headers.get('location') ?? '').searchParams.get('state') ??
      '';
    const cookie = cookiePair(
      init.headers.getSetCookie(),
      'notion_login_state'
    );
    return { state, cookie };
  }

  const connectUrl = (state: string) =>
    `/api/notion/connect?code=provider-code&state=${encodeURIComponent(state)}`;

  it('forwards the login state to the sign-in callback, which signs in once', async () => {
    const { state, cookie } = await startNotionSignIn();

    const forward = await get(connectUrl(state), cookie);
    const forwardedTo = forward.headers.get('location') ?? '';
    const signedIn = await get(forwardedTo, cookie);

    expect(forward.status).toBe(302);
    expect(new URL(forwardedTo, base).pathname).toBe('/api/users/auth/notion');
    expect(exchangesWith(NOTION_TOKEN_URL)).toHaveLength(1);
    expect(signedIn.headers.get('location')).toBe('/notion');
    expect(setsSession(signedIn)).toBe(true);
    expect(await holder.db!('notion_tokens').count('* as n')).toEqual([
      { n: 1 },
    ]);
  });

  it('refuses a forwarded callback with no state cookie and no session, and points to a fresh sign-in', async () => {
    const { state } = await startNotionSignIn();

    const forward = await get(connectUrl(state), '');
    const refused = await get(forward.headers.get('location') ?? '', '');

    expect(refused.headers.get('location')).toBe(
      '/login?error=notion_signin_expired'
    );
    clearsOnly(refused, 'notion_login_state');
    expect(exchangesWith(NOTION_TOKEN_URL)).toHaveLength(0);
    expect(await holder.db!('notion_tokens').count('* as n')).toEqual([
      { n: 0 },
    ]);
  });
});

const LOGIN_RETURN = 'login_return';
const MCP_RETURN_PATH = '/mcp/authorize?client_id=c1&state=s1';
const returnCookie = (path: string) =>
  `${LOGIN_RETURN}=${encodeURIComponent(path)}`;
const mcpCookie = `mcp_login_return=${encodeURIComponent(MCP_RETURN_PATH)}`;
const joinCookies = (...pairs: string[]) =>
  pairs.filter((pair) => pair !== '').join('; ');
const clearsReturnCookie = (res: Response) =>
  res.headers
    .getSetCookie()
    .some((c) => /^login_return=;.*Expires=Thu, 01 Jan 1970/.test(c));

interface StartedSignIn {
  res: Response;
  state: string;
  stateCookie: string;
  returnCookie: string;
}

async function startSignInAt(
  initPath: string,
  stateCookieName: string,
  cookie: string
): Promise<StartedSignIn> {
  const res = await get(initPath, cookie);
  const setCookies = res.headers.getSetCookie();
  return {
    res,
    state:
      new URL(res.headers.get('location') ?? '').searchParams.get('state') ??
      '',
    stateCookie: cookiePair(setCookies, stateCookieName),
    returnCookie: cookiePair(setCookies, LOGIN_RETURN),
  };
}

describe.each(providers)(
  'a $provider sign-in started with a return target',
  ({ init, callback, stateCookie, landing }) => {
    const startSignIn = (query: string, cookie = '') =>
      startSignInAt(`${init}${query}`, stateCookie, cookie);

    const finish = (state: string, cookie: string) =>
      get(
        `${callback}?code=provider-code&state=${encodeURIComponent(state)}`,
        cookie
      );

    it('lands on an allowlisted target and clears the return cookie', async () => {
      const started = await startSignIn('?redirect=/card-options');

      const done = await finish(
        started.state,
        joinCookies(started.stateCookie, started.returnCookie)
      );

      expect(started.res.status).toBe(302);
      expect(started.returnCookie).toBe(returnCookie('/card-options'));
      expect(done.headers.get('location')).toBe('/card-options');
      expect(clearsReturnCookie(done)).toBe(true);
    });

    it('sets no return cookie for a target outside the allowlist and lands on the default', async () => {
      const started = await startSignIn(
        `?redirect=${encodeURIComponent('https://evil.com/print')}`
      );

      const done = await finish(started.state, started.stateCookie);

      expect(cookieNames(started.res)).not.toContain(LOGIN_RETURN);
      expect(done.headers.get('location')).toBe(landing);
    });

    it('leaves a return cookie from the login page alone when the button carries no target', async () => {
      const started = await startSignIn('', returnCookie('/print'));

      const done = await finish(
        started.state,
        joinCookies(started.stateCookie, returnCookie('/print'))
      );

      expect(cookieNames(started.res)).not.toContain(LOGIN_RETURN);
      expect(done.headers.get('location')).toBe('/print');
    });

    it('replaces an older return cookie with the target the button carries', async () => {
      const started = await startSignIn(
        '?redirect=/card-options',
        returnCookie('/print')
      );

      const done = await finish(
        started.state,
        joinCookies(started.stateCookie, started.returnCookie)
      );

      expect(started.returnCookie).toBe(returnCookie('/card-options'));
      expect(done.headers.get('location')).toBe('/card-options');
    });

    it('keeps the connector return ahead of the target the button carries', async () => {
      const started = await startSignIn('?redirect=/card-options', mcpCookie);

      const done = await finish(
        started.state,
        joinCookies(started.stateCookie, started.returnCookie, mcpCookie)
      );

      expect(done.headers.get('location')).toBe(MCP_RETURN_PATH);
    });

    it('lands a sign-in started on the connector plans page back on it, marked as a return', async () => {
      const started = await startSignIn(
        `?redirect=${encodeURIComponent('/pricing?ref=mcp&k=partial&a=b')}`
      );

      const done = await finish(
        started.state,
        joinCookies(started.stateCookie, started.returnCookie)
      );

      expect(done.headers.get('location')).toBe(
        '/pricing?ref=mcp&k=partial&a=b&r=1'
      );
    });
  }
);

describe('an Apple sign-in started with a return target', () => {
  const APPLE_CLIENT_ID = 'com.2anki.web';
  const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
  const appleClientKey = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });

  beforeEach(() => {
    vi.stubEnv('APPLE_CLIENT_ID', APPLE_CLIENT_ID);
    vi.stubEnv('APPLE_TEAM_ID', 'team-1');
    vi.stubEnv('APPLE_KEY_ID', 'key-1');
    vi.stubEnv(
      'APPLE_PRIVATE_KEY_B64',
      Buffer.from(
        appleClientKey.privateKey.export({ type: 'pkcs8', format: 'pem' })
      ).toString('base64')
    );
    __resetAppleJwksCacheForTests();
    (instrumentedAxios.post as Mock).mockImplementation(async (_l, url) => {
      if (url === APPLE_TOKEN_URL) {
        return {
          data: {
            id_token: signIdToken({
              iss: 'https://appleid.apple.com',
              aud: APPLE_CLIENT_ID,
              sub: 'apple-sub-1',
              email: EMAIL,
              email_verified: true,
            }),
          },
        };
      }
      throw new Error(`unexpected POST ${url}`);
    });
  });

  const startSignIn = (query: string, cookie = '') =>
    startSignInAt(
      `/api/users/auth/apple/init${query}`,
      'apple_login_state',
      cookie
    );

  const finish = (state: string, cookie: string) =>
    fetch(`${base}/auth/apple/callback`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'Mozilla/5.0',
      },
      body: new URLSearchParams({ code: 'provider-code', state }).toString(),
      redirect: 'manual',
    });

  it('lands on an allowlisted target and clears the return cookie', async () => {
    const started = await startSignIn('?redirect=/photo-to-deck');

    const done = await finish(
      started.state,
      joinCookies(started.stateCookie, started.returnCookie)
    );

    expect(started.returnCookie).toBe(returnCookie('/photo-to-deck'));
    expect(done.headers.get('location')).toBe('/photo-to-deck');
    expect(clearsReturnCookie(done)).toBe(true);
  });

  it('sets no return cookie for a target outside the allowlist and lands on the default', async () => {
    const started = await startSignIn('?redirect=//evil.com');

    const done = await finish(started.state, started.stateCookie);

    expect(cookieNames(started.res)).not.toContain(LOGIN_RETURN);
    expect(done.headers.get('location')).toBe('/upload');
  });

  it('leaves a return cookie from the login page alone when the button carries no target', async () => {
    const started = await startSignIn('', returnCookie('/print'));

    const done = await finish(
      started.state,
      joinCookies(started.stateCookie, returnCookie('/print'))
    );

    expect(cookieNames(started.res)).not.toContain(LOGIN_RETURN);
    expect(done.headers.get('location')).toBe('/print');
  });

  it('replaces an older return cookie with the target the button carries', async () => {
    const started = await startSignIn(
      '?redirect=/card-options',
      returnCookie('/print')
    );

    const done = await finish(
      started.state,
      joinCookies(started.stateCookie, started.returnCookie)
    );

    expect(started.returnCookie).toBe(returnCookie('/card-options'));
    expect(done.headers.get('location')).toBe('/card-options');
  });

  it('keeps the connector return ahead of the target the button carries', async () => {
    const started = await startSignIn('?redirect=/card-options', mcpCookie);

    const done = await finish(
      started.state,
      joinCookies(started.stateCookie, started.returnCookie, mcpCookie)
    );

    expect(done.headers.get('location')).toBe(MCP_RETURN_PATH);
  });
});
