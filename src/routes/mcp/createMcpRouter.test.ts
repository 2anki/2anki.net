import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

import { InMemoryRateLimiter } from '../../lib/rateLimit/InMemoryRateLimiter';

import { createMcpRouter, McpRouterDeps } from './createMcpRouter';

const RESOURCE = 'https://2anki.net/mcp';

function fakeProvider(): OAuthServerProvider {
  return {
    clientsStore: {
      getClient: async () => undefined,
      registerClient: async (client) => ({
        ...client,
        client_id: 'generated',
        client_id_issued_at: 1,
      }),
    },
    authorize: async () => {},
    challengeForAuthorizationCode: async () => 'chal',
    exchangeAuthorizationCode: async () => ({
      access_token: 'a',
      token_type: 'bearer',
    }),
    exchangeRefreshToken: async () => ({
      access_token: 'a',
      token_type: 'bearer',
    }),
    verifyAccessToken: async (token: string): Promise<AuthInfo> => {
      if (token !== 'good') {
        throw new Error('bad token');
      }
      return {
        token,
        clientId: 'client-1',
        scopes: ['mcp'],
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        resource: new URL(RESOURCE),
        extra: { owner: '1' },
      };
    },
  };
}

async function withServer(
  run: (baseUrl: string) => Promise<void>,
  onPost: express.RequestHandler = (_req, res) => {
    res.json({ ok: true });
  },
  mountExtra?: (app: express.Express) => void,
  depsOverride?: Partial<McpRouterDeps>
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(
    createMcpRouter({
      provider: fakeProvider(),
      issuerUrl: new URL('https://2anki.net'),
      resourceUrl: new URL(RESOURCE),
      onAuthenticatedPost: onPost,
      consentSecret: 'test-secret',
      logClientError: () => {},
      ...depsOverride,
    })
  );
  if (mountExtra) {
    mountExtra(app);
  }
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('McpRouter discovery', () => {
  it('serves authorization-server metadata with the standard endpoints', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, string>;
      expect(body.issuer).toBe('https://2anki.net/');
      expect(body.authorization_endpoint).toBe(
        'https://2anki.net/mcp/authorize'
      );
      expect(body.token_endpoint).toBe('https://2anki.net/mcp/token');
      expect(body.registration_endpoint).toBe('https://2anki.net/mcp/register');
    });
  });

  it('advertises Client ID Metadata Documents alongside DCR', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.client_id_metadata_document_supported).toBe(true);
      expect(body.token_endpoint_auth_methods_supported).toContain('none');
      expect(body.registration_endpoint).toBe('https://2anki.net/mcp/register');
    });
  });

  it('advertises the iss parameter on authorization responses', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/.well-known/oauth-authorization-server`);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.authorization_response_iss_parameter_supported).toBe(true);
    });
  });

  it('serves protected-resource metadata for the /mcp resource', async () => {
    await withServer(async (base) => {
      const res = await fetch(
        `${base}/.well-known/oauth-protected-resource/mcp`
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { resource: string };
      expect(body.resource).toBe(RESOURCE);
    });
  });
});

describe('McpRouter bearer enforcement', () => {
  it('rejects an unauthenticated POST /mcp with a WWW-Authenticate challenge', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('Bearer');
    });
  });

  it('logs why it refused a POST /mcp, which the SDK does not', async () => {
    const lines: string[] = [];
    await withServer(
      async (base) => {
        const res = await fetch(`${base}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
        });
        expect(res.status).toBe(401);
        await res.text();
      },
      undefined,
      undefined,
      { logClientError: (line) => lines.push(line) }
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[mcp] POST /mcp 401 code=invalid_token');
    expect(lines[0]).toContain('method=ping');
  });

  it('reaches the authenticated handler with a valid bearer token', async () => {
    let reachedOwner: unknown = null;
    await withServer(
      async (base) => {
        const res = await fetch(`${base}/mcp`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer good',
          },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
        });
        expect(res.status).toBe(200);
      },
      (req, res) => {
        reachedOwner = req.auth?.extra?.owner;
        res.json({ ok: true });
      }
    );
    expect(reachedOwner).toBe('1');
  });

  it('returns 405 for GET /mcp with a valid token', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/mcp`, {
        headers: { authorization: 'Bearer good' },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    });
  });
});

describe('McpRouter mistyped connector URLs', () => {
  it.each(['/mc', '/mcp.', '/MC', '/mc/', '/mcp./'])(
    'redirects a POST to %s to /mcp keeping the query',
    async (path) => {
      await withServer(async (base) => {
        const res = await fetch(`${base}${path}?x=1`, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
        });
        expect(res.status).toBe(308);
        expect(res.headers.get('location')).toBe('/mcp?x=1');
      });
    }
  );

  it('redirects a GET, such as a browser visit, to /mcp', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/mc`, { redirect: 'manual' });
      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe('/mcp');
    });
  });

  it('keeps an off-site-looking query on /mcp', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/mc?//evil.example`, {
        redirect: 'manual',
      });
      expect(res.headers.get('location')).toBe('/mcp?//evil.example');
    });
  });

  it('lands an unauthenticated client on the bearer challenge after the redirect', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/mcp.`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain(
        'resource_metadata'
      );
    });
  });

  it('answers a GET with a token 405 after the redirect, as /mcp does', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/mc`, {
        headers: { authorization: 'Bearer good' },
      });
      expect(res.status).toBe(405);
    });
  });

  it('reaches the authenticated handler when a client follows the redirect', async () => {
    let reached = false;
    await withServer(
      async (base) => {
        const res = await fetch(`${base}/mc`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer good',
          },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
        });
        expect(res.status).toBe(200);
      },
      (_req, res) => {
        reached = true;
        res.json({ ok: true });
      }
    );
    expect(reached).toBe(true);
  });

  it.each(['/mcp.json', '/mcp/sse', '/mc.', '/mcpx'])(
    'does not redirect %s',
    async (path) => {
      await withServer(async (base) => {
        const res = await fetch(`${base}${path}`, { redirect: 'manual' });
        expect(res.status).toBe(404);
      });
    }
  );
});

describe('McpRouter endpoint namespacing (no /register collision)', () => {
  it('does not shadow GET /register — the signup SPA still serves', async () => {
    await withServer(
      async (base) => {
        const res = await fetch(`${base}/register`);
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('SIGNUP_SPA');
      },
      undefined,
      (app) => {
        app.get('/register', (_req, res) => res.send('SIGNUP_SPA'));
      }
    );
  });

  it('registers a client via Dynamic Client Registration at /mcp/register', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/mcp/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['https://claude.ai/callback'] }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { client_id?: string };
      expect(typeof body.client_id).toBe('string');
    });
  });

  it('routes POST /mcp (resource) and /mcp/authorize (AS) to distinct handlers', async () => {
    await withServer(async (base) => {
      const authorize = await fetch(`${base}/mcp/authorize`, {
        redirect: 'manual',
      });
      expect(authorize.status).not.toBe(405);

      const resource = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 }),
      });
      expect(resource.status).toBe(401);
    });
  });
});

const REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';

function providerRedirectingTo(
  buildRedirect: (redirectUri: string, state?: string) => string
): OAuthServerProvider {
  return {
    ...fakeProvider(),
    clientsStore: {
      getClient: async (clientId) => ({
        client_id: clientId,
        redirect_uris: [REDIRECT_URI],
      }),
    },
    authorize: async (_client, params, res) => {
      res.redirect(buildRedirect(params.redirectUri, params.state));
    },
  };
}

async function authorizeLocation(
  provider: OAuthServerProvider,
  query: Record<string, string>
): Promise<URL> {
  let location = '';
  await withServer(
    async (base) => {
      const res = await fetch(
        `${base}/mcp/authorize?${new URLSearchParams(query).toString()}`,
        { redirect: 'manual' }
      );
      location = res.headers.get('location') ?? '';
    },
    undefined,
    undefined,
    { provider }
  );
  return new URL(location);
}

const AUTHORIZE_QUERY = {
  client_id: 'client-1',
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  code_challenge: 'challenge',
  code_challenge_method: 'S256',
  state: 'state-1',
};

describe('McpRouter authorization responses (RFC 9207)', () => {
  it('names the issuer on a success redirect', async () => {
    const url = await authorizeLocation(
      providerRedirectingTo(
        (uri, state) => `${uri}?code=code-1&state=${state ?? ''}`
      ),
      AUTHORIZE_QUERY
    );

    expect(url.origin + url.pathname).toBe(REDIRECT_URI);
    expect(url.searchParams.get('iss')).toBe('https://2anki.net/');
    expect(url.searchParams.get('code')).toBe('code-1');
    expect(url.searchParams.get('state')).toBe('state-1');
  });

  it('names the issuer when the user denies access', async () => {
    const url = await authorizeLocation(
      providerRedirectingTo(
        (uri, state) => `${uri}?error=access_denied&state=${state ?? ''}`
      ),
      AUTHORIZE_QUERY
    );

    expect(url.searchParams.get('iss')).toBe('https://2anki.net/');
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('state')).toBe('state-1');
  });

  it('names the issuer on an error redirect the SDK builds', async () => {
    const { code_challenge: _omitted, ...withoutChallenge } = AUTHORIZE_QUERY;
    const url = await authorizeLocation(
      providerRedirectingTo((uri) => uri),
      withoutChallenge
    );

    expect(url.searchParams.get('iss')).toBe('https://2anki.net/');
    expect(url.searchParams.get('error')).toBe('invalid_request');
  });
});

function registerBody() {
  return JSON.stringify({ redirect_uris: ['https://claude.ai/callback'] });
}

describe('McpRouter registration rate limiting', () => {
  it('registers a client while under the per-IP cap', async () => {
    const limiter = new InMemoryRateLimiter({
      windowMs: 60_000,
      perKeyMax: 2,
      globalMax: 100,
    });
    await withServer(
      async (base) => {
        for (let i = 0; i < 2; i += 1) {
          const res = await fetch(`${base}/mcp/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: registerBody(),
          });
          expect(res.status).toBe(201);
        }
      },
      undefined,
      undefined,
      { rateLimiters: { register: limiter } }
    );
  });

  it('returns 429 with a rate_limited body once the per-IP cap is exceeded', async () => {
    const limiter = new InMemoryRateLimiter({
      windowMs: 60_000,
      perKeyMax: 2,
      globalMax: 100,
    });
    await withServer(
      async (base) => {
        for (let i = 0; i < 2; i += 1) {
          await fetch(`${base}/mcp/register`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: registerBody(),
          });
        }
        const blocked = await fetch(`${base}/mcp/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: registerBody(),
        });
        expect(blocked.status).toBe(429);
        const body = (await blocked.json()) as {
          error?: string;
          error_description?: string;
        };
        expect(body.error).toBe('rate_limited');
        expect(typeof body.error_description).toBe('string');
      },
      undefined,
      undefined,
      { rateLimiters: { register: limiter } }
    );
  });
});

describe('McpRouter consent-secret boot assertion', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('throws when the consent secret is empty in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      createMcpRouter({
        provider: fakeProvider(),
        issuerUrl: new URL('https://2anki.net'),
        resourceUrl: new URL(RESOURCE),
        onAuthenticatedPost: (_req, res) => res.json({ ok: true }),
        consentSecret: '',
      })
    ).toThrow();
  });

  it('does not throw for an empty consent secret outside production', () => {
    process.env.NODE_ENV = 'development';
    expect(() =>
      createMcpRouter({
        provider: fakeProvider(),
        issuerUrl: new URL('https://2anki.net'),
        resourceUrl: new URL(RESOURCE),
        onAuthenticatedPost: (_req, res) => res.json({ ok: true }),
        consentSecret: '',
      })
    ).not.toThrow();
  });
});
