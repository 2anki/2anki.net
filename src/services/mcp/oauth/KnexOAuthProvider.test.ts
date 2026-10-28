import { vi } from 'vitest';
import express, { Response } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

import { KnexOAuthProvider, McpOAuthDeps } from './KnexOAuthProvider';
import {
  CreateAuthorizationCodeInput,
  IMcpAuthorizationCodeRepository,
  StoredAuthorizationCode,
} from '../../../data_layer/McpAuthorizationCodeRepository';
import {
  CreateTokenInput,
  IMcpTokenRepository,
  StoredToken,
} from '../../../data_layer/McpTokenRepository';
import {
  IMcpOAuthClientRepository,
  StoredMcpClient,
} from '../../../data_layer/McpOAuthClientRepository';
import { hashSecret } from './tokens';
import { computeConsentToken } from './consent';
import {
  ClientMetadataDocumentResolver,
  storageClientIdFor,
} from './clientMetadataDocument';
import type { InstrumentedAxios } from '../../observability/instrumentedAxios';
import UsersController from '../../../controllers/UsersControllers';
import type UsersService from '../../UsersService';
import type AuthenticationService from '../../AuthenticationService';
import { MCP_AUTHORIZE_PATH } from '../../../lib/mcp/loginReturn';

vi.mock('../../events/track', () => ({ track: vi.fn() }));

const RESOURCE = 'https://2anki.net/mcp';
const TEST_CONSENT_SECRET = 'test-consent-secret';

class FakeClientRepo implements IMcpOAuthClientRepository {
  clients = new Map<string, StoredMcpClient>();
  async create(client: StoredMcpClient): Promise<StoredMcpClient> {
    this.clients.set(client.client_id, client);
    return client;
  }
  async upsert(client: StoredMcpClient): Promise<void> {
    this.clients.set(client.client_id, client);
  }
  async findById(clientId: string): Promise<StoredMcpClient | null> {
    return this.clients.get(clientId) ?? null;
  }
  async deleteOrphaned(issuedBeforeUnixSeconds: number): Promise<number> {
    let deleted = 0;
    for (const [id, client] of this.clients) {
      if (client.client_id_issued_at < issuedBeforeUnixSeconds) {
        this.clients.delete(id);
        deleted++;
      }
    }
    return deleted;
  }
}

class FakeCodeRepo implements IMcpAuthorizationCodeRepository {
  rows: StoredAuthorizationCode[] = [];
  private byHash = new Map<string, StoredAuthorizationCode>();
  private nextId = 1;
  async create(input: CreateAuthorizationCodeInput): Promise<void> {
    const row: StoredAuthorizationCode = {
      id: this.nextId++,
      client_id: input.client_id,
      user_id: input.user_id,
      redirect_uri: input.redirect_uri,
      code_challenge: input.code_challenge,
      scopes: input.scopes,
      resource: input.resource,
      expires_at: input.expires_at,
      consumed_at: null,
    };
    this.rows.push(row);
    this.byHash.set(input.code_hash, row);
  }
  async findByHash(codeHash: string): Promise<StoredAuthorizationCode | null> {
    return this.byHash.get(codeHash) ?? null;
  }
  seed(codeHash: string, row: Omit<StoredAuthorizationCode, 'id'>): void {
    const stored = { id: this.nextId++, ...row };
    this.byHash.set(codeHash, stored);
    this.rows.push(stored);
  }
  async consume(id: number, now: Date): Promise<boolean> {
    for (const row of this.byHash.values()) {
      if (row.id === id && row.consumed_at == null) {
        row.consumed_at = now;
        return true;
      }
    }
    return false;
  }
  async deleteExpired(now: Date): Promise<number> {
    let deleted = 0;
    for (const [hash, row] of this.byHash) {
      if (row.expires_at < now) {
        this.byHash.delete(hash);
        this.rows = this.rows.filter((r) => r.id !== row.id);
        deleted++;
      }
    }
    return deleted;
  }
}

class FakeTokenRepo implements IMcpTokenRepository {
  access = new Map<string, StoredToken>();
  refresh = new Map<string, StoredToken>();
  private id = 1;
  async createAccessToken(input: CreateTokenInput): Promise<void> {
    this.access.set(input.token_hash, {
      id: this.id++,
      revoked_at: null,
      ...input,
    });
  }
  async createRefreshToken(input: CreateTokenInput): Promise<void> {
    this.refresh.set(input.token_hash, {
      id: this.id++,
      revoked_at: null,
      ...input,
    });
  }
  async findAccessTokenByHash(h: string): Promise<StoredToken | null> {
    return this.access.get(h) ?? null;
  }
  async findRefreshTokenByHash(h: string): Promise<StoredToken | null> {
    return this.refresh.get(h) ?? null;
  }
  async revokeAccessTokenByHash(h: string): Promise<void> {
    const t = this.access.get(h);
    if (t) t.revoked_at = new Date();
  }
  async revokeRefreshTokenByHash(h: string): Promise<void> {
    const t = this.refresh.get(h);
    if (t) t.revoked_at = new Date();
  }
  async revokeAllForUserClient(): Promise<void> {}
  async deleteExpiredAccessTokens(now: Date): Promise<number> {
    return this.deleteExpiredFrom(this.access, now);
  }
  async deleteExpiredRefreshTokens(now: Date): Promise<number> {
    return this.deleteExpiredFrom(this.refresh, now);
  }
  private deleteExpiredFrom(
    store: Map<string, StoredToken>,
    now: Date
  ): number {
    let deleted = 0;
    for (const [hash, token] of store) {
      if (token.expires_at < now) {
        store.delete(hash);
        deleted++;
      }
    }
    return deleted;
  }
}

function fakeResponse(
  cookieToken?: string,
  reqOverrides: {
    method?: string;
    body?: Record<string, unknown>;
    consent?: 'granted' | 'denied';
    cookies?: Record<string, string>;
  } = {}
) {
  const calls = {
    redirectedTo: null as string | null,
    cookies: [] as {
      name: string;
      value: string;
      options?: Record<string, unknown>;
    }[],
    clearedCookies: [] as string[],
    statusCode: null as number | null,
    body: null as unknown,
    headers: {} as Record<string, string>,
  };
  const res = {
    req: {
      cookies: {
        ...(cookieToken != null ? { token: cookieToken } : {}),
        ...(reqOverrides.consent != null
          ? { cookie_consent: reqOverrides.consent }
          : {}),
        ...reqOverrides.cookies,
      },
      originalUrl: '/mcp/authorize?client_id=abc&state=xyz',
      method: reqOverrides.method ?? 'GET',
      body: reqOverrides.body ?? {},
    },
    redirect(target: string) {
      calls.redirectedTo = target;
    },
    cookie(name: string, value: string, options?: Record<string, unknown>) {
      calls.cookies.push({ name, value, options });
    },
    clearCookie(name: string) {
      calls.clearedCookies.push(name);
    },
    status(code: number) {
      calls.statusCode = code;
      return this;
    },
    set(field: string, value: string) {
      calls.headers[field.toLowerCase()] = value;
      return this;
    },
    send(payload: unknown) {
      calls.body = payload;
      return this;
    },
  } as unknown as Response;
  return { res, calls };
}

function makeProvider(overrides: Partial<McpOAuthDeps> = {}) {
  const clientRepo = new FakeClientRepo();
  const codeRepo = new FakeCodeRepo();
  const tokenRepo = new FakeTokenRepo();
  const now = new Date('2026-07-18T00:00:00.000Z');
  const authService = {
    getUserFrom: vi.fn(async (token: string) => {
      if (token === 'valid-session') {
        return { id: 42, email: 'a@b.co', developer_access: true };
      }
      if (token === 'valid-no-dev') {
        return { id: 43, email: 'c@d.co', developer_access: false };
      }
      return null;
    }),
  } as unknown as McpOAuthDeps['authService'];
  const usersRepo = {
    getById: vi.fn(async (id: string) =>
      id === '42' ? { id: 42, email: 'a@b.co' } : null
    ),
  } as unknown as McpOAuthDeps['usersRepo'];
  const provider = new KnexOAuthProvider({
    clientRepo,
    codeRepo,
    tokenRepo,
    authService,
    usersRepo,
    config: {
      resourceUrl: new URL(RESOURCE),
      loginPath: '/login',
      authorizePath: '/authorize',
      consentSecret: TEST_CONSENT_SECRET,
    },
    now: () => now,
    ...overrides,
  });
  return { provider, clientRepo, codeRepo, tokenRepo, now };
}

const CLIENT: OAuthClientInformationFull = {
  client_id: 'client-1',
  redirect_uris: ['https://claude.ai/callback'],
  token_endpoint_auth_method: 'none',
};

describe('KnexOAuthProvider client registration', () => {
  it('registers a public client and never persists a secret', async () => {
    const { provider, clientRepo } = makeProvider();
    const result = await provider.clientsStore.registerClient!({
      redirect_uris: ['https://claude.ai/callback'],
      client_name: 'Claude',
    } as OAuthClientInformationFull);
    expect(result.token_endpoint_auth_method).toBe('none');
    expect(result.client_secret).toBeUndefined();
    const stored = await clientRepo.findById(result.client_id);
    expect(stored?.token_endpoint_auth_method).toBe('none');
  });

  it.each([
    ['http non-loopback', ['http://evil.example/cb']],
    ['fragment', ['https://claude.ai/cb#frag']],
    ['not a url', ['not-a-url']],
    ['empty list', []],
  ])('rejects invalid redirect_uris: %s', async (_label, uris) => {
    const { provider } = makeProvider();
    await expect(
      provider.clientsStore.registerClient!({
        redirect_uris: uris,
      } as OAuthClientInformationFull)
    ).rejects.toThrow();
  });

  it('allows http loopback redirect for native clients', async () => {
    const { provider } = makeProvider();
    const result = await provider.clientsStore.registerClient!({
      redirect_uris: ['http://127.0.0.1:1234/cb'],
    } as OAuthClientInformationFull);
    expect(result.redirect_uris).toContain('http://127.0.0.1:1234/cb');
  });
});

describe('KnexOAuthProvider authorize', () => {
  it('redirects to login and sets first-touch when not signed in and tracking is allowed', async () => {
    const { provider } = makeProvider();
    const { res, calls } = fakeResponse(undefined, { consent: 'granted' });
    await provider.authorize(
      CLIENT,
      {
        codeChallenge: 'chal',
        redirectUri: 'https://claude.ai/callback',
        state: 'xyz',
      },
      res
    );
    expect(calls.redirectedTo).toBe(
      '/login?redirect=%2Fmcp%2Fauthorize%3Fclient_id%3Dabc%26state%3Dxyz'
    );
    expect(calls.cookies[0].name).toBe('first_touch');
    expect(calls.cookies[0].value).toContain('/mcp');
  });

  it('redirects to login without first-touch when tracking is not allowed', async () => {
    const { provider } = makeProvider();
    const { res, calls } = fakeResponse();
    await provider.authorize(
      CLIENT,
      {
        codeChallenge: 'chal',
        redirectUri: 'https://claude.ai/callback',
        state: 'xyz',
      },
      res
    );
    expect(calls.redirectedTo).toBe(
      '/login?redirect=%2Fmcp%2Fauthorize%3Fclient_id%3Dabc%26state%3Dxyz'
    );
    expect(calls.cookies.map((c) => c.name)).not.toContain('first_touch');
  });

  it('remembers the authorize URL in a short-lived return cookie when not signed in', async () => {
    const { provider } = makeProvider();
    const { res, calls } = fakeResponse();
    await provider.authorize(
      CLIENT,
      {
        codeChallenge: 'chal',
        redirectUri: 'https://claude.ai/callback',
        state: 'xyz',
      },
      res
    );
    expect(calls.cookies).toEqual([
      {
        name: 'mcp_login_return',
        value: '/mcp/authorize?client_id=abc&state=xyz',
        options: {
          httpOnly: true,
          secure: true,
          sameSite: 'none',
          path: '/',
          maxAge: 10 * 60 * 1000,
        },
      },
    ]);
  });

  it('sends a signed-out POST to plain login, since its parameters are not in the URL', async () => {
    const { provider } = makeProvider();
    const { res, calls } = fakeResponse(undefined, { method: 'POST' });
    await provider.authorize(
      CLIENT,
      {
        codeChallenge: 'chal',
        redirectUri: 'https://claude.ai/callback',
        state: 'xyz',
      },
      res
    );
    expect(calls.redirectedTo).toBe('/login');
    expect(calls.cookies.map((c) => c.name)).not.toContain('mcp_login_return');
  });

  it('clears the return cookie once the user is back at authorize signed in', async () => {
    const { provider } = makeProvider();
    const { res, calls } = fakeResponse('valid-session', {
      cookies: { mcp_login_return: '/mcp/authorize?client_id=abc' },
    });
    await provider.authorize(
      CLIENT,
      {
        codeChallenge: 'chal',
        redirectUri: 'https://claude.ai/callback',
        state: 'xyz',
      },
      res
    );
    expect(calls.clearedCookies).toEqual(['mcp_login_return']);
    expect(calls.redirectedTo).toBeNull();
  });

  const AUTHORIZE_PARAMS = {
    codeChallenge: 'chal-123',
    redirectUri: 'https://claude.ai/callback',
    state: 'xyz',
    scopes: ['mcp'],
  };

  it('renders a consent page and issues no code on a GET when signed in', async () => {
    const { provider, codeRepo } = makeProvider();
    const { res, calls } = fakeResponse('valid-session');
    await provider.authorize(CLIENT, AUTHORIZE_PARAMS, res);
    expect(calls.redirectedTo).toBeNull();
    expect(calls.statusCode).toBe(200);
    expect(String(calls.body)).toContain('name="consent"');
    expect(String(calls.body)).toContain('name="csrf"');
    expect(codeRepo.rows).toHaveLength(0);
  });

  it('shows the redirect host of the authorize request on the consent page', async () => {
    const { provider } = makeProvider();
    const { res, calls } = fakeResponse('valid-session');
    await provider.authorize(CLIENT, AUTHORIZE_PARAMS, res);
    expect(String(calls.body)).toContain(
      `<strong>${new URL(AUTHORIZE_PARAMS.redirectUri).hostname}</strong>`
    );
  });

  it('mints a code only after a POST approval with a valid CSRF token', async () => {
    const { provider, codeRepo } = makeProvider();
    const csrf = computeConsentToken('valid-session', TEST_CONSENT_SECRET);
    const { res, calls } = fakeResponse('valid-session', {
      method: 'POST',
      body: { consent: 'approve', csrf },
    });
    await provider.authorize(CLIENT, AUTHORIZE_PARAMS, res);
    expect(calls.redirectedTo).toMatch(
      /^https:\/\/claude\.ai\/callback\?code=mcp_ac_/
    );
    expect(calls.redirectedTo).toContain('state=xyz');
    expect(codeRepo.rows).toHaveLength(1);
    expect(codeRepo.rows[0].code_challenge).toBe('chal-123');
    expect(codeRepo.rows[0].user_id).toBe(42);
  });

  it('does not mint a code on a POST approval with a wrong CSRF token', async () => {
    const { provider, codeRepo } = makeProvider();
    const { res, calls } = fakeResponse('valid-session', {
      method: 'POST',
      body: { consent: 'approve', csrf: 'forged-token' },
    });
    await provider.authorize(CLIENT, AUTHORIZE_PARAMS, res);
    expect(calls.redirectedTo).toBeNull();
    expect(calls.statusCode).toBe(200);
    expect(codeRepo.rows).toHaveLength(0);
  });

  it('does not mint a code when the CSRF token is bound to a different session', async () => {
    const { provider, codeRepo } = makeProvider();
    const otherSessionCsrf = computeConsentToken(
      'someone-elses-session',
      TEST_CONSENT_SECRET
    );
    const { res } = fakeResponse('valid-session', {
      method: 'POST',
      body: { consent: 'approve', csrf: otherSessionCsrf },
    });
    await provider.authorize(CLIENT, AUTHORIZE_PARAMS, res);
    expect(codeRepo.rows).toHaveLength(0);
  });

  it('redirects with access_denied and issues no code on a POST deny', async () => {
    const { provider, codeRepo } = makeProvider();
    const { res, calls } = fakeResponse('valid-session', {
      method: 'POST',
      body: { consent: 'deny' },
    });
    await provider.authorize(CLIENT, AUTHORIZE_PARAMS, res);
    expect(calls.redirectedTo).toContain('error=access_denied');
    expect(codeRepo.rows).toHaveLength(0);
  });

  it('renders consent for any signed-in account, including one without developer_access', async () => {
    const { provider, codeRepo } = makeProvider();
    const { res, calls } = fakeResponse('valid-no-dev');
    await provider.authorize(CLIENT, AUTHORIZE_PARAMS, res);
    expect(calls.redirectedTo).toBeNull();
    expect(calls.statusCode).toBe(200);
    expect(String(calls.body)).toContain('name="consent"');
    expect(codeRepo.rows).toHaveLength(0);
  });

  it('mints a code for a plain account without developer_access on POST approval', async () => {
    const { provider, codeRepo } = makeProvider();
    const csrf = computeConsentToken('valid-no-dev', TEST_CONSENT_SECRET);
    const { res, calls } = fakeResponse('valid-no-dev', {
      method: 'POST',
      body: { consent: 'approve', csrf },
    });
    await provider.authorize(CLIENT, AUTHORIZE_PARAMS, res);
    expect(calls.redirectedTo).toMatch(
      /^https:\/\/claude\.ai\/callback\?code=mcp_ac_/
    );
    expect(codeRepo.rows).toHaveLength(1);
    expect(codeRepo.rows[0].user_id).toBe(43);
  });
});

describe('KnexOAuthProvider token exchange', () => {
  function seedCode(
    codeRepo: FakeCodeRepo,
    code: string,
    overrides: Partial<StoredAuthorizationCode> = {}
  ) {
    codeRepo.seed(hashSecret(code), {
      client_id: 'client-1',
      user_id: 42,
      redirect_uri: 'https://claude.ai/callback',
      code_challenge: 'chal',
      scopes: ['mcp'],
      resource: RESOURCE,
      expires_at: new Date('2026-07-18T00:04:00.000Z'),
      consumed_at: null,
      ...overrides,
    });
  }

  it('exchanges a valid code for an access + refresh token pair', async () => {
    const { provider, codeRepo, tokenRepo } = makeProvider();
    seedCode(codeRepo, 'the-code');
    const tokens = await provider.exchangeAuthorizationCode(
      CLIENT,
      'the-code',
      undefined,
      'https://claude.ai/callback',
      new URL(RESOURCE)
    );
    expect(tokens.access_token).toMatch(/^mcp_at_/);
    expect(tokens.refresh_token).toMatch(/^mcp_rt_/);
    expect(tokenRepo.access.size).toBe(1);
    expect(tokenRepo.refresh.size).toBe(1);
  });

  it('rejects a reused authorization code', async () => {
    const { provider, codeRepo } = makeProvider();
    seedCode(codeRepo, 'once');
    await provider.exchangeAuthorizationCode(
      CLIENT,
      'once',
      undefined,
      'https://claude.ai/callback'
    );
    await expect(
      provider.exchangeAuthorizationCode(
        CLIENT,
        'once',
        undefined,
        'https://claude.ai/callback'
      )
    ).rejects.toThrow(/already used/);
  });

  it('rejects an expired code', async () => {
    const { provider, codeRepo } = makeProvider();
    seedCode(codeRepo, 'stale', {
      expires_at: new Date('2026-07-17T23:00:00.000Z'),
    });
    await expect(
      provider.exchangeAuthorizationCode(
        CLIENT,
        'stale',
        undefined,
        'https://claude.ai/callback'
      )
    ).rejects.toThrow(/expired/);
  });

  it('rejects a redirect_uri mismatch', async () => {
    const { provider, codeRepo } = makeProvider();
    seedCode(codeRepo, 'code');
    await expect(
      provider.exchangeAuthorizationCode(
        CLIENT,
        'code',
        undefined,
        'https://evil.example/cb'
      )
    ).rejects.toThrow(/redirect_uri/);
  });

  it('rejects a code that belongs to a different client', async () => {
    const { provider, codeRepo } = makeProvider();
    seedCode(codeRepo, 'code', { client_id: 'other-client' });
    await expect(
      provider.exchangeAuthorizationCode(
        CLIENT,
        'code',
        undefined,
        'https://claude.ai/callback'
      )
    ).rejects.toThrow(/Invalid authorization code/);
  });

  it('rejects a resource that does not match the server', async () => {
    const { provider, codeRepo } = makeProvider();
    seedCode(codeRepo, 'code');
    await expect(
      provider.exchangeAuthorizationCode(
        CLIENT,
        'code',
        undefined,
        'https://claude.ai/callback',
        new URL('https://evil.example/mcp')
      )
    ).rejects.toThrow(/resource/);
  });
});

describe('KnexOAuthProvider refresh + verify + revoke', () => {
  async function issue(provider: KnexOAuthProvider, codeRepo: FakeCodeRepo) {
    codeRepo.seed(hashSecret('c'), {
      client_id: 'client-1',
      user_id: 42,
      redirect_uri: 'https://claude.ai/callback',
      code_challenge: 'chal',
      scopes: ['mcp'],
      resource: RESOURCE,
      expires_at: new Date('2026-07-18T00:04:00.000Z'),
      consumed_at: null,
    });
    return provider.exchangeAuthorizationCode(
      CLIENT,
      'c',
      undefined,
      'https://claude.ai/callback'
    );
  }

  it('rotates the refresh token and revokes the old one', async () => {
    const { provider, codeRepo, tokenRepo } = makeProvider();
    const first = await issue(provider, codeRepo);
    const rotated = await provider.exchangeRefreshToken(
      CLIENT,
      first.refresh_token!
    );
    expect(rotated.refresh_token).not.toEqual(first.refresh_token);
    expect(
      tokenRepo.refresh.get(hashSecret(first.refresh_token!))?.revoked_at
    ).not.toBeNull();
  });

  it('verifies a live access token and resolves the owner', async () => {
    const { provider, codeRepo } = makeProvider();
    const tokens = await issue(provider, codeRepo);
    const info = await provider.verifyAccessToken(tokens.access_token);
    expect(info.clientId).toBe('client-1');
    expect(info.extra?.owner).toBe(42);
    expect(info.resource?.toString()).toContain('/mcp');
  });

  it('rejects a revoked access token', async () => {
    const { provider, codeRepo, tokenRepo } = makeProvider();
    const tokens = await issue(provider, codeRepo);
    const t = tokenRepo.access.get(hashSecret(tokens.access_token));
    if (t) t.revoked_at = new Date();
    await expect(
      provider.verifyAccessToken(tokens.access_token)
    ).rejects.toThrow(/revoked/);
  });

  it('rejects an unknown access token', async () => {
    const { provider } = makeProvider();
    await expect(provider.verifyAccessToken('mcp_at_nope')).rejects.toThrow(
      /Invalid access token/
    );
  });
});

describe('authorize endpoint through the SDK handler (CSRF gate)', () => {
  async function withAuthorizeServer(
    run: (base: string, codeRepo: FakeCodeRepo) => Promise<void>
  ) {
    const { provider, clientRepo, codeRepo } = makeProvider();
    await clientRepo.create({
      client_id: 'client-1',
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'mcp',
      token_endpoint_auth_method: 'none',
      metadata: {},
      client_id_issued_at: 1,
    });
    const app = express();
    app.use(cookieParser());
    app.use('/authorize', authorizationHandler({ provider, rateLimit: false }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(`http://127.0.0.1:${port}`, codeRepo);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('a signed-in GET renders consent and issues NO code (no CSRF-validated POST)', async () => {
    await withAuthorizeServer(async (base, codeRepo) => {
      const query = new URLSearchParams({
        client_id: 'client-1',
        redirect_uri: 'https://claude.ai/callback',
        response_type: 'code',
        code_challenge: 'chal',
        code_challenge_method: 'S256',
        state: 'xyz',
      });
      const res = await fetch(`${base}/authorize?${query.toString()}`, {
        headers: { cookie: 'token=valid-session' },
        redirect: 'manual',
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('name="consent"');
      expect(codeRepo.rows).toHaveLength(0);
    });
  });
});

describe('signed-out connect: authorize -> sign in -> back to authorize', () => {
  const query = new URLSearchParams({
    client_id: 'client-1',
    redirect_uri: 'https://claude.ai/callback',
    response_type: 'code',
    code_challenge: 'chal',
    code_challenge_method: 'S256',
    state: 'xyz',
  }).toString();
  const authorizeUrl = `${MCP_AUTHORIZE_PATH}?${query}`;

  async function withSigninServer(run: (base: string) => Promise<void>) {
    const { provider, clientRepo } = makeProvider();
    await clientRepo.create({
      client_id: 'client-1',
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'mcp',
      token_endpoint_auth_method: 'none',
      metadata: {},
      client_id_issued_at: 1,
    });
    const user = { id: 42, email: 'a@b.co', password: 'hash' };
    const controller = new UsersController(
      {
        getUserFrom: vi.fn().mockResolvedValue(user),
        markEmailVerified: vi.fn().mockResolvedValue(1),
        updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
      } as unknown as UsersService,
      {
        isValidLogin: vi.fn().mockReturnValue(true),
        comparePassword: vi.fn().mockReturnValue(true),
        // The provider's fake auth service accepts this session token.
        newJWTToken: vi.fn().mockResolvedValue('valid-session'),
        persistToken: vi.fn().mockResolvedValue(undefined),
        loginWithGoogle: vi
          .fn()
          .mockResolvedValue({ ok: true, email: 'a@b.co', name: 'A' }),
      } as unknown as AuthenticationService,
      {} as ReturnType<typeof import('../../../data_layer').getDatabase>
    );
    const app = express();
    app.use(cookieParser());
    app.use(
      MCP_AUTHORIZE_PATH,
      authorizationHandler({ provider, rateLimit: false })
    );
    app.post('/api/users/login', express.json(), (req, res, next) =>
      controller.login(req, res, next)
    );
    app.get('/api/users/auth/google', (req, res) =>
      controller.loginWithGoogle(req, res)
    );
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  async function startSignedOut(base: string) {
    const res = await fetch(`${base}${authorizeUrl}`, { redirect: 'manual' });
    const location = res.headers.get('location') ?? '';
    const returnCookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith('mcp_login_return='));
    return { status: res.status, location, returnCookie };
  }

  it('password sign-in lands back on the consent screen with the same query', async () => {
    await withSigninServer(async (base) => {
      const start = await startSignedOut(base);
      expect(start.status).toBe(302);
      const loginUrl = new URL(start.location, base);
      expect(loginUrl.pathname).toBe('/login');
      expect(loginUrl.searchParams.get('redirect')).toBe(authorizeUrl);

      // The login page posts to the API with its own query string.
      const login = await fetch(`${base}/api/users/login${loginUrl.search}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.co', password: 'pw' }),
      });
      const { redirect } = (await login.json()) as { redirect: string };
      expect(redirect).toBe(authorizeUrl);

      const back = await fetch(`${base}${redirect}`, {
        headers: { cookie: 'token=valid-session' },
        redirect: 'manual',
      });
      expect(back.status).toBe(200);
      expect(await back.text()).toContain('name="consent"');
    });
  });

  it('Google sign-in comes back to the consent screen through the return cookie', async () => {
    await withSigninServer(async (base) => {
      const start = await startSignedOut(base);
      expect(start.returnCookie).toContain('HttpOnly');
      expect(start.returnCookie).toContain('Secure');
      const cookiePair = (start.returnCookie ?? '').split(';')[0];

      const google = await fetch(`${base}/api/users/auth/google?code=g1`, {
        headers: { cookie: cookiePair },
        redirect: 'manual',
      });
      expect(google.status).toBe(302);
      expect(google.headers.get('location')).toBe(authorizeUrl);
      expect(
        google.headers
          .getSetCookie()
          .some((c) => c.startsWith('mcp_login_return=;'))
      ).toBe(true);

      const back = await fetch(`${base}${authorizeUrl}`, {
        headers: { cookie: 'token=valid-session' },
        redirect: 'manual',
      });
      expect(back.status).toBe(200);
      expect(await back.text()).toContain('name="consent"');
    });
  });
});

describe('bearer auth through the SDK middleware', () => {
  async function withBearerServer(
    run: (
      base: string,
      ctx: { issueToken: () => Promise<string>; tokenRepo: FakeTokenRepo }
    ) => Promise<void>
  ) {
    const { provider, codeRepo, tokenRepo } = makeProvider({
      now: () => new Date(),
    });
    const app = express();
    app.post(
      '/mcp',
      requireBearerAuth({
        verifier: provider,
        resourceMetadataUrl: `${RESOURCE}/.well-known/oauth-protected-resource`,
      }),
      (_req, res) => {
        res.json({ ok: true });
      }
    );
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    const issueToken = async () => {
      codeRepo.seed(hashSecret('c'), {
        client_id: 'client-1',
        user_id: 42,
        redirect_uri: 'https://claude.ai/callback',
        code_challenge: 'chal',
        scopes: ['mcp'],
        resource: RESOURCE,
        expires_at: new Date(Date.now() + 60_000),
        consumed_at: null,
      });
      const tokens = await provider.exchangeAuthorizationCode(
        CLIENT,
        'c',
        undefined,
        'https://claude.ai/callback'
      );
      return tokens.access_token;
    };
    try {
      await run(`http://127.0.0.1:${port}`, { issueToken, tokenRepo });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  const post = (base: string, token: string) =>
    fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });

  it('lets a valid access token through', async () => {
    await withBearerServer(async (base, { issueToken }) => {
      const res = await post(base, await issueToken());

      expect(res.status).toBe(200);
    });
  });

  it.each([
    [
      'an unknown token',
      async (_ctx: { tokenRepo: FakeTokenRepo }, _token: string) => undefined,
      'mcp_at_nope',
    ],
    [
      'a revoked token',
      async (ctx: { tokenRepo: FakeTokenRepo }, token: string) => {
        const row = ctx.tokenRepo.access.get(hashSecret(token));
        if (row == null) throw new Error('token row missing');
        row.revoked_at = new Date();
      },
      null,
    ],
    [
      'an expired token',
      async (ctx: { tokenRepo: FakeTokenRepo }, token: string) => {
        const row = ctx.tokenRepo.access.get(hashSecret(token));
        if (row == null) throw new Error('token row missing');
        row.expires_at = new Date(Date.now() - 1000);
      },
      null,
    ],
    [
      'a token whose owner no longer exists',
      async (ctx: { tokenRepo: FakeTokenRepo }, token: string) => {
        const row = ctx.tokenRepo.access.get(hashSecret(token));
        if (row == null) throw new Error('token row missing');
        row.user_id = 99;
      },
      null,
    ],
  ])(
    'answers 401 invalid_token for %s so the client refreshes instead of giving up',
    async (_label, breakToken, fixedToken) => {
      await withBearerServer(async (base, ctx) => {
        const token = fixedToken ?? (await ctx.issueToken());
        await breakToken(ctx, token);

        const res = await post(base, token);

        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toContain(
          'error="invalid_token"'
        );
        expect(await res.json()).toMatchObject({ error: 'invalid_token' });
      });
    }
  );
});

describe('Client ID Metadata Document clients', () => {
  const CIMD_ID = 'https://claude.ai/oauth/mcp-client-metadata';
  const STORAGE_ID = storageClientIdFor(CIMD_ID);
  const VERIFIER = 'cimd-test-verifier-0123456789abcdefghijklmnopqrstuvwxyz';
  const CHALLENGE = crypto
    .createHash('sha256')
    .update(VERIFIER)
    .digest('base64url');

  function metadataHttp(doc: Record<string, unknown>) {
    const get = vi.fn(async () => ({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      config: {} as never,
      data: JSON.stringify(doc),
    }));
    return { get, http: { get } as unknown as InstrumentedAxios };
  }

  function makeCimdProvider(redirectUris: string[]) {
    const { get, http } = metadataHttp({
      client_id: CIMD_ID,
      client_name: 'Claude',
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
    });
    const built = makeProvider({
      clientMetadataResolver: new ClientMetadataDocumentResolver({ http }),
    });
    return { ...built, fetchDocument: get };
  }

  async function withOAuthServer(
    redirectUris: string[],
    run: (
      base: string,
      ctx: ReturnType<typeof makeCimdProvider>
    ) => Promise<void>
  ) {
    const ctx = makeCimdProvider(redirectUris);
    const app = express();
    app.use(cookieParser());
    app.use(
      '/authorize',
      authorizationHandler({ provider: ctx.provider, rateLimit: false })
    );
    app.use(
      '/token',
      tokenHandler({ provider: ctx.provider, rateLimit: false })
    );
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(`http://127.0.0.1:${port}`, ctx);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  function authorizeQuery(redirectUri: string): Record<string, string> {
    return {
      client_id: CIMD_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      scope: 'mcp',
      state: 'xyz',
    };
  }

  async function approve(base: string, redirectUri: string): Promise<string> {
    const csrf = computeConsentToken('valid-session', TEST_CONSENT_SECRET);
    const res = await fetch(`${base}/authorize`, {
      method: 'POST',
      headers: {
        cookie: 'token=valid-session',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        ...authorizeQuery(redirectUri),
        consent: 'approve',
        csrf,
      }).toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    const code = location.searchParams.get('code');
    if (code == null) throw new Error(`no code in ${location.toString()}`);
    return code;
  }

  function tokenRequest(base: string, params: Record<string, string>) {
    return fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CIMD_ID, ...params }).toString(),
    });
  }

  it('resolves the client from its metadata document without registering it', async () => {
    const { provider, clientRepo } = makeCimdProvider([
      'https://claude.ai/api/mcp/auth_callback',
    ]);

    const client = await provider.clientsStore.getClient(CIMD_ID);

    expect(client).toMatchObject({
      client_id: CIMD_ID,
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none',
    });
    expect(clientRepo.clients.size).toBe(0);
  });

  it('never accepts a storage id as a client_id on the wire', async () => {
    const { provider, clientRepo } = makeCimdProvider([
      'https://claude.ai/api/mcp/auth_callback',
    ]);
    await clientRepo.upsert({
      client_id: STORAGE_ID,
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      scope: null,
      token_endpoint_auth_method: 'none',
      metadata: {},
      client_id_issued_at: 1,
    });

    expect(await provider.clientsStore.getClient(STORAGE_ID)).toBeUndefined();
  });

  it('treats a rejected metadata document as an unknown client', async () => {
    const { http } = metadataHttp({
      client_id: 'https://evil.example/doc',
      redirect_uris: ['https://evil.example/cb'],
    });
    const { provider } = makeProvider({
      clientMetadataResolver: new ClientMetadataDocumentResolver({ http }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await provider.clientsStore.getClient(CIMD_ID)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('client_id_mismatch')
    );
    warn.mockRestore();
  });

  it('shows the client name, redirect host and document host on consent', async () => {
    await withOAuthServer(
      ['https://claude.ai/api/mcp/auth_callback'],
      async (base) => {
        const query = new URLSearchParams(
          authorizeQuery('https://claude.ai/api/mcp/auth_callback')
        );
        const res = await fetch(`${base}/authorize?${query.toString()}`, {
          headers: { cookie: 'token=valid-session' },
          redirect: 'manual',
        });

        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('Connect Claude to 2anki');
        expect(html).toContain("you'll go back to <strong>claude.ai</strong>");
        expect(html).toContain('identified by <strong>claude.ai</strong>');
      }
    );
  });

  it.each([
    ['http://localhost/callback', 'http://localhost:53682/callback'],
    ['http://127.0.0.1/callback', 'http://127.0.0.1:9000/callback'],
    ['http://localhost:3118/callback', 'http://localhost:4000/callback'],
    [
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.ai/api/mcp/auth_callback',
    ],
  ])(
    'accepts redirect %s when the request uses %s',
    async (registered, requested) => {
      await withOAuthServer([registered], async (base) => {
        const query = new URLSearchParams(authorizeQuery(requested));
        const res = await fetch(`${base}/authorize?${query.toString()}`, {
          headers: { cookie: 'token=valid-session' },
          redirect: 'manual',
        });

        expect(res.status).toBe(200);
      });
    }
  );

  it.each([
    ['https://claude.ai/api/mcp/auth_callback', 'https://claude.ai/other'],
    [
      'https://claude.ai/api/mcp/auth_callback',
      'https://claude.ai:8443/api/mcp/auth_callback',
    ],
    ['http://localhost/callback', 'http://localhost:53682/elsewhere'],
    ['http://localhost/callback', 'http://127.0.0.1:53682/callback'],
  ])(
    'rejects redirect %s when the request uses %s',
    async (registered, requested) => {
      await withOAuthServer([registered], async (base, { codeRepo }) => {
        const query = new URLSearchParams(authorizeQuery(requested));
        const res = await fetch(`${base}/authorize?${query.toString()}`, {
          headers: { cookie: 'token=valid-session' },
          redirect: 'manual',
        });

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: 'invalid_request' });
        expect(codeRepo.rows).toHaveLength(0);
      });
    }
  );

  it('stores one client row per document across connections', async () => {
    await withOAuthServer(
      ['http://localhost/callback'],
      async (base, { clientRepo, codeRepo }) => {
        await approve(base, 'http://localhost:5000/callback');
        await approve(base, 'http://localhost:6000/callback');

        expect([...clientRepo.clients.keys()]).toEqual([STORAGE_ID]);
        expect(clientRepo.clients.get(STORAGE_ID)).toMatchObject({
          client_name: 'Claude',
          token_endpoint_auth_method: 'none',
          metadata: { client_id_metadata_document: CIMD_ID },
        });
        expect(codeRepo.rows.map((row) => row.client_id)).toEqual([
          STORAGE_ID,
          STORAGE_ID,
        ]);
      }
    );
  });

  it('exchanges the code with PKCE and no client secret, then rotates refresh tokens', async () => {
    await withOAuthServer(
      ['http://localhost/callback'],
      async (base, { fetchDocument }) => {
        const redirectUri = 'http://localhost:5000/callback';
        const code = await approve(base, redirectUri);

        const exchanged = await tokenRequest(base, {
          grant_type: 'authorization_code',
          code,
          code_verifier: VERIFIER,
          redirect_uri: redirectUri,
        });
        expect(exchanged.status).toBe(200);
        const tokens = (await exchanged.json()) as {
          access_token: string;
          refresh_token: string;
        };

        const refreshed = await tokenRequest(base, {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
        });
        expect(refreshed.status).toBe(200);

        const reused = await tokenRequest(base, {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
        });
        expect(reused.status).toBe(400);
        expect(await reused.json()).toMatchObject({ error: 'invalid_grant' });
        expect(fetchDocument).toHaveBeenCalledTimes(1);
      }
    );
  });

  it('rejects a code exchange with the wrong PKCE verifier', async () => {
    await withOAuthServer(['http://localhost/callback'], async (base) => {
      const redirectUri = 'http://localhost:5000/callback';
      const code = await approve(base, redirectUri);

      const res = await tokenRequest(base, {
        grant_type: 'authorization_code',
        code,
        code_verifier: `${VERIFIER}-wrong`,
        redirect_uri: redirectUri,
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_grant' });
    });
  });

  it('does not let a DCR client redeem a CIMD client code', async () => {
    const { provider, clientRepo, codeRepo } = makeCimdProvider([
      'https://claude.ai/api/mcp/auth_callback',
    ]);
    const cimdClient = await provider.clientsStore.getClient(CIMD_ID);
    const csrf = computeConsentToken('valid-session', TEST_CONSENT_SECRET);
    const { res, calls } = fakeResponse('valid-session', {
      method: 'POST',
      body: { consent: 'approve', csrf },
    });
    await provider.authorize(
      cimdClient!,
      {
        codeChallenge: CHALLENGE,
        redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      },
      res
    );
    const code = new URL(calls.redirectedTo!).searchParams.get('code')!;
    expect(clientRepo.clients.has(STORAGE_ID)).toBe(true);
    expect(codeRepo.rows).toHaveLength(1);

    await expect(
      provider.exchangeAuthorizationCode(
        CLIENT,
        code,
        undefined,
        'https://claude.ai/api/mcp/auth_callback'
      )
    ).rejects.toThrow(InvalidGrantError);
    await expect(
      provider.exchangeAuthorizationCode(
        cimdClient!,
        code,
        undefined,
        'https://claude.ai/api/mcp/auth_callback'
      )
    ).resolves.toMatchObject({ token_type: 'bearer' });
  });
});

describe('resource indicators through the SDK handlers', () => {
  const VERIFIER = 'resource-test-verifier-0123456789abcdefghijklmnopqrstuv';
  const CHALLENGE = crypto
    .createHash('sha256')
    .update(VERIFIER)
    .digest('base64url');

  async function withServer(
    run: (base: string, codeRepo: FakeCodeRepo) => Promise<void>
  ) {
    const { provider, clientRepo, codeRepo } = makeProvider();
    await clientRepo.create({
      client_id: 'client-1',
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'mcp',
      token_endpoint_auth_method: 'none',
      metadata: {},
      client_id_issued_at: 1,
    });
    const app = express();
    app.use(cookieParser());
    app.use('/authorize', authorizationHandler({ provider, rateLimit: false }));
    app.use('/token', tokenHandler({ provider, rateLimit: false }));
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(`http://127.0.0.1:${port}`, codeRepo);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  function authorizeQuery(resource: string): URLSearchParams {
    return new URLSearchParams({
      client_id: 'client-1',
      redirect_uri: 'https://claude.ai/callback',
      response_type: 'code',
      code_challenge: CHALLENGE,
      code_challenge_method: 'S256',
      state: 'xyz',
      resource,
    });
  }

  it('sends a foreign resource back to the client as invalid_target before consent', async () => {
    await withServer(async (base, codeRepo) => {
      const res = await fetch(
        `${base}/authorize?${authorizeQuery('https://evil.example/mcp').toString()}`,
        { headers: { cookie: 'token=valid-session' }, redirect: 'manual' }
      );
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get('location') ?? '');
      expect(location.origin + location.pathname).toBe(
        'https://claude.ai/callback'
      );
      expect(location.searchParams.get('error')).toBe('invalid_target');
      expect(location.searchParams.get('state')).toBe('xyz');
      expect(codeRepo.rows).toHaveLength(0);
    });
  });

  it('issues no code for a foreign resource even on an approved POST', async () => {
    await withServer(async (base, codeRepo) => {
      const csrf = computeConsentToken('valid-session', TEST_CONSENT_SECRET);
      const body = authorizeQuery('https://evil.example/mcp');
      body.set('consent', 'approve');
      body.set('csrf', csrf);
      const res = await fetch(`${base}/authorize`, {
        method: 'POST',
        headers: {
          cookie: 'token=valid-session',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        redirect: 'manual',
      });
      expect(res.status).toBe(302);
      expect(
        new URL(res.headers.get('location') ?? '').searchParams.get('error')
      ).toBe('invalid_target');
      expect(codeRepo.rows).toHaveLength(0);
    });
  });

  it.each([RESOURCE, `${RESOURCE}/`])(
    'still shows consent for this server as the resource (%s)',
    async (resource) => {
      await withServer(async (base) => {
        const res = await fetch(
          `${base}/authorize?${authorizeQuery(resource).toString()}`,
          { headers: { cookie: 'token=valid-session' }, redirect: 'manual' }
        );
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('name="consent"');
      });
    }
  );

  it('answers a stored foreign resource at the token step with 400 invalid_target', async () => {
    await withServer(async (base, codeRepo) => {
      codeRepo.seed(hashSecret('foreign-code'), {
        client_id: 'client-1',
        user_id: 42,
        redirect_uri: 'https://claude.ai/callback',
        code_challenge: CHALLENGE,
        scopes: ['mcp'],
        resource: 'https://evil.example/mcp',
        expires_at: new Date('2026-07-18T00:10:00.000Z'),
        consumed_at: null,
      });
      const res = await fetch(`${base}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: 'client-1',
          grant_type: 'authorization_code',
          code: 'foreign-code',
          code_verifier: VERIFIER,
          redirect_uri: 'https://claude.ai/callback',
        }).toString(),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_target' });
    });
  });

  it('answers a foreign resource on the token request with 400 invalid_target', async () => {
    await withServer(async (base, codeRepo) => {
      codeRepo.seed(hashSecret('own-code'), {
        client_id: 'client-1',
        user_id: 42,
        redirect_uri: 'https://claude.ai/callback',
        code_challenge: CHALLENGE,
        scopes: ['mcp'],
        resource: RESOURCE,
        expires_at: new Date('2026-07-18T00:10:00.000Z'),
        consumed_at: null,
      });
      const res = await fetch(`${base}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: 'client-1',
          grant_type: 'authorization_code',
          code: 'own-code',
          code_verifier: VERIFIER,
          redirect_uri: 'https://claude.ai/callback',
          resource: 'https://evil.example/mcp',
        }).toString(),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_target' });
    });
  });
});

describe('token exchange failure logging', () => {
  const SEED = {
    client_id: 'client-1',
    user_id: 42,
    redirect_uri: 'https://claude.ai/callback',
    code_challenge: 'chal',
    scopes: ['mcp'],
    resource: RESOURCE,
    expires_at: new Date('2026-07-18T00:10:00.000Z'),
    consumed_at: null,
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs the error class, never the code, when an exchange fails unexpectedly', async () => {
    const { provider, codeRepo } = makeProvider();
    codeRepo.seed(hashSecret('secret-code'), SEED);
    vi.spyOn(codeRepo, 'consume').mockRejectedValue(
      new TypeError('connection lost')
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      provider.exchangeAuthorizationCode(
        CLIENT,
        'secret-code',
        undefined,
        'https://claude.ai/callback'
      )
    ).rejects.toThrow(TypeError);
    expect(log).toHaveBeenCalledWith('[mcp-oauth] token exchange failed', {
      grantType: 'authorization_code',
      errorClass: 'TypeError',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-code');
  });

  it('does not log an expected OAuth rejection', async () => {
    const { provider } = makeProvider();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      provider.exchangeRefreshToken(CLIENT, 'unknown-refresh-token')
    ).rejects.toThrow(InvalidGrantError);
    expect(log).not.toHaveBeenCalled();
  });
});
