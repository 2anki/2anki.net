import express, { RequestHandler } from 'express';
import {
  createOAuthMetadata,
  mcpAuthMetadataRouter,
  getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { revocationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/revoke.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';

import {
  InMemoryRateLimiter,
  RateLimiter,
} from '../../lib/rateLimit/InMemoryRateLimiter';
import { hashIp, resolveClientIp } from '../../lib/rateLimit/ipHelpers';
import { mcpFirstTouchMiddleware } from './mcpFirstTouch';
import { authorizationResponseIssuer } from './authorizationResponseIssuer';
import { MCP_AUTHORIZE_PATH } from '../../lib/mcp/loginReturn';

export { MCP_AUTHORIZE_PATH };
export const MCP_TOKEN_PATH = '/mcp/token';
export const MCP_REGISTER_PATH = '/mcp/register';
export const MCP_REVOKE_PATH = '/mcp/revoke';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const REGISTER_PER_IP_MAX = 10;
const REGISTER_GLOBAL_MAX = 500;
const AUTHORIZE_PER_IP_MAX = 30;
const AUTHORIZE_GLOBAL_MAX = 3000;
const TOKEN_PER_IP_MAX = 60;
const TOKEN_GLOBAL_MAX = 6000;

export interface McpRateLimiters {
  register: RateLimiter;
  authorize: RateLimiter;
  token: RateLimiter;
}

export interface McpRouterDeps {
  provider: OAuthServerProvider;
  issuerUrl: URL;
  resourceUrl: URL;
  onAuthenticatedPost: RequestHandler;
  consentSecret: string;
  rateLimiters?: Partial<McpRateLimiters>;
}

function rateLimit(limiter: RateLimiter): RequestHandler {
  return (req, res, next) => {
    if (limiter.check(hashIp(resolveClientIp(req)))) {
      next();
      return;
    }
    res.set('Retry-After', '60');
    res.status(429).json({
      error: 'rate_limited',
      error_description:
        'Too many requests from this network. Wait a moment and try again.',
    });
  };
}

export function createMcpRouter(deps: McpRouterDeps): express.Router {
  if (
    process.env.NODE_ENV === 'production' &&
    deps.consentSecret.length === 0
  ) {
    throw new Error(
      'MCP consent secret is empty in production. Set process.env.SECRET.'
    );
  }

  const router = express.Router();
  const { provider, issuerUrl, resourceUrl } = deps;

  const registerLimiter =
    deps.rateLimiters?.register ??
    new InMemoryRateLimiter({
      windowMs: HOUR_MS,
      perKeyMax: REGISTER_PER_IP_MAX,
      globalMax: REGISTER_GLOBAL_MAX,
    });
  const authorizeLimiter =
    deps.rateLimiters?.authorize ??
    new InMemoryRateLimiter({
      windowMs: MINUTE_MS,
      perKeyMax: AUTHORIZE_PER_IP_MAX,
      globalMax: AUTHORIZE_GLOBAL_MAX,
    });
  const tokenLimiter =
    deps.rateLimiters?.token ??
    new InMemoryRateLimiter({
      windowMs: MINUTE_MS,
      perKeyMax: TOKEN_PER_IP_MAX,
      globalMax: TOKEN_GLOBAL_MAX,
    });

  const baseMetadata = createOAuthMetadata({
    provider,
    issuerUrl,
    scopesSupported: ['mcp'],
  });
  const oauthMetadata = {
    ...baseMetadata,
    authorization_endpoint: new URL(MCP_AUTHORIZE_PATH, issuerUrl).href,
    token_endpoint: new URL(MCP_TOKEN_PATH, issuerUrl).href,
    authorization_response_iss_parameter_supported: true,
    // Claude uses CIMD only when this flag AND "none" in
    // token_endpoint_auth_methods_supported are both advertised; otherwise
    // it falls back to registration_endpoint (DCR).
    client_id_metadata_document_supported: true,
    token_endpoint_auth_methods_supported: Array.from(
      new Set([
        ...(baseMetadata.token_endpoint_auth_methods_supported ?? []),
        'none',
      ])
    ),
    ...(baseMetadata.registration_endpoint
      ? { registration_endpoint: new URL(MCP_REGISTER_PATH, issuerUrl).href }
      : {}),
    ...(baseMetadata.revocation_endpoint
      ? { revocation_endpoint: new URL(MCP_REVOKE_PATH, issuerUrl).href }
      : {}),
  };

  router.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: resourceUrl,
      scopesSupported: ['mcp'],
      resourceName: '2anki',
    })
  );

  router.use(
    MCP_AUTHORIZE_PATH,
    mcpFirstTouchMiddleware,
    rateLimit(authorizeLimiter),
    authorizationResponseIssuer(baseMetadata.issuer),
    authorizationHandler({ provider })
  );
  router.use(
    MCP_TOKEN_PATH,
    rateLimit(tokenLimiter),
    tokenHandler({ provider })
  );
  if (baseMetadata.registration_endpoint) {
    router.use(
      MCP_REGISTER_PATH,
      rateLimit(registerLimiter),
      clientRegistrationHandler({ clientsStore: provider.clientsStore })
    );
  }
  if (baseMetadata.revocation_endpoint) {
    router.use(MCP_REVOKE_PATH, revocationHandler({ provider }));
  }

  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
  });

  router.post('/mcp', bearer, deps.onAuthenticatedPost);
  router.get('/mcp', bearer, (_req, res) => {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
  });
  router.delete('/mcp', bearer, (_req, res) => {
    res.set('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
  });

  return router;
}
