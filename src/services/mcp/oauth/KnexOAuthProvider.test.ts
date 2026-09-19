import express, { Response } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import cookieParser from 'cookie-parser';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

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

const RESOURCE = 'https://2anki.net/mcp';
const TEST_CONSENT_SECRET = 'test-consent-secret';

class FakeClientRepo implements IMcpOAuthClientRepository {
  clients = new Map<string, StoredMcpClient>();
  async create(client: StoredMcpClient): Promise<StoredMcpClient> {
    this.clients.set(client.client_id, client);
    return client;
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
  reqOverrides: { method?: string; body?: Record<string, unknown> } = {}
) {
  const calls = {
    redirectedTo: null as string | null,
    cookies: [] as { name: string; value: string }[],
    statusCode: null as number | null,
    body: null as unknown,
    headers: {} as Record<string, string>,
  };
  const res = {
    req: {
      cookies: cookieToken != null ? { token: cookieToken } : {},
      originalUrl: '/authorize?client_id=abc&state=xyz',
      method: reqOverrides.method ?? 'GET',
      body: reqOverrides.body ?? {},
    },
    redirect(target: string) {
      calls.redirectedTo = target;
    },
    cookie(name: string, value: string) {
      calls.cookies.push({ name, value });
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
    getUserFrom: jest.fn(async (token: string) => {
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
    getById: jest.fn(async (id: string) =>
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
  it('redirects to login and sets first-touch when not signed in', async () => {
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
    expect(calls.redirectedTo).toContain('/login?next=');
    expect(calls.cookies[0].name).toBe('first_touch');
    expect(calls.cookies[0].value).toContain('/mcp');
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
        if (row) row.revoked_at = new Date();
      },
      null,
    ],
    [
      'an expired token',
      async (ctx: { tokenRepo: FakeTokenRepo }, token: string) => {
        const row = ctx.tokenRepo.access.get(hashSecret(token));
        if (row) row.expires_at = new Date(Date.now() - 1000);
      },
      null,
    ],
    [
      'a token whose owner no longer exists',
      async (ctx: { tokenRepo: FakeTokenRepo }, token: string) => {
        const row = ctx.tokenRepo.access.get(hashSecret(token));
        if (row) row.user_id = 99;
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
