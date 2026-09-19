import { Response } from 'express';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidTokenError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';

import AuthenticationService from '../../AuthenticationService';
import UsersRepository from '../../../data_layer/UsersRepository';
import { IMcpOAuthClientRepository } from '../../../data_layer/McpOAuthClientRepository';
import { IMcpAuthorizationCodeRepository } from '../../../data_layer/McpAuthorizationCodeRepository';
import { IMcpTokenRepository } from '../../../data_layer/McpTokenRepository';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  generateAccessToken,
  generateAuthorizationCode,
  generateClientId,
  generateRefreshToken,
  hashSecret,
} from './tokens';
import {
  computeConsentToken,
  consentTokenMatches,
  renderConsentPage,
} from './consent';

const MAX_REDIRECT_URIS = 10;
const MAX_CLIENT_NAME_LENGTH = 255;

export interface McpOAuthConfig {
  resourceUrl: URL;
  loginPath: string;
  authorizePath: string;
  consentSecret: string;
}

export interface McpOAuthDeps {
  clientRepo: IMcpOAuthClientRepository;
  codeRepo: IMcpAuthorizationCodeRepository;
  tokenRepo: IMcpTokenRepository;
  authService: AuthenticationService;
  usersRepo: UsersRepository;
  config: McpOAuthConfig;
  now?: () => Date;
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

export function assertValidRedirectUris(uris: string[]): void {
  if (uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    throw new InvalidRequestError('Invalid number of redirect_uris');
  }
  for (const uri of uris) {
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new InvalidRequestError(`Invalid redirect_uri: ${uri}`);
    }
    if (parsed.hash !== '') {
      throw new InvalidRequestError('redirect_uri must not contain a fragment');
    }
    const isHttps = parsed.protocol === 'https:';
    const isHttpLoopback =
      parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname);
    if (!isHttps && !isHttpLoopback) {
      throw new InvalidRequestError(
        'redirect_uri must use https, or http only for loopback'
      );
    }
  }
}

function canonicalResource(value: URL): string {
  const url = new URL(value.toString());
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

class KnexClientsStore implements OAuthRegisteredClientsStore {
  constructor(private readonly clientRepo: IMcpOAuthClientRepository) {}

  async getClient(
    clientId: string
  ): Promise<OAuthClientInformationFull | undefined> {
    const stored = await this.clientRepo.findById(clientId);
    if (stored == null) {
      return undefined;
    }
    return {
      client_id: stored.client_id,
      redirect_uris: stored.redirect_uris,
      grant_types: stored.grant_types,
      response_types: stored.response_types,
      scope: stored.scope ?? undefined,
      token_endpoint_auth_method: 'none',
      client_name: stored.client_name ?? undefined,
      client_id_issued_at: stored.client_id_issued_at,
    };
  }

  async registerClient(
    client: Omit<
      OAuthClientInformationFull,
      'client_id' | 'client_id_issued_at'
    >
  ): Promise<OAuthClientInformationFull> {
    assertValidRedirectUris(client.redirect_uris);
    const clientName =
      client.client_name != null
        ? client.client_name.slice(0, MAX_CLIENT_NAME_LENGTH)
        : null;
    const clientId = generateClientId();
    const issuedAt = Math.floor(Date.now() / 1000);
    const grantTypes = client.grant_types ?? [
      'authorization_code',
      'refresh_token',
    ];
    const responseTypes = client.response_types ?? ['code'];
    await this.clientRepo.create({
      client_id: clientId,
      client_name: clientName,
      redirect_uris: client.redirect_uris,
      grant_types: grantTypes,
      response_types: responseTypes,
      scope: client.scope ?? null,
      token_endpoint_auth_method: 'none',
      metadata: { ...client, token_endpoint_auth_method: 'none' },
      client_id_issued_at: issuedAt,
    });
    return {
      client_id: clientId,
      client_id_issued_at: issuedAt,
      redirect_uris: client.redirect_uris,
      grant_types: grantTypes,
      response_types: responseTypes,
      scope: client.scope ?? undefined,
      token_endpoint_auth_method: 'none',
      client_name: clientName ?? undefined,
    };
  }
}

export class KnexOAuthProvider implements OAuthServerProvider {
  private readonly store: KnexClientsStore;
  private readonly now: () => Date;

  constructor(private readonly deps: McpOAuthDeps) {
    this.store = new KnexClientsStore(deps.clientRepo);
    this.now = deps.now ?? (() => new Date());
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this.store;
  }

  private async resolveLoggedInUser(res: Response): Promise<{
    id: number;
    sessionToken: string;
  } | null> {
    const cookies = res.req?.cookies as Record<string, unknown> | undefined;
    const token = cookies?.token;
    if (typeof token !== 'string' || token.length === 0) {
      return null;
    }
    const user = await this.deps.authService.getUserFrom(token);
    if (user == null) {
      return null;
    }
    return {
      id: Number(user.id),
      sessionToken: token,
    };
  }

  private redirectToLogin(res: Response): void {
    const originalUrl = res.req?.originalUrl ?? '';
    const cookies = res.req?.cookies as Record<string, unknown> | undefined;
    if (cookies?.first_touch == null) {
      res.cookie('first_touch', JSON.stringify({ landingPath: '/mcp' }), {
        httpOnly: false,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 30,
      });
    }
    const target = `${this.deps.config.loginPath}?next=${encodeURIComponent(
      originalUrl
    )}`;
    res.redirect(target);
  }

  private redirectWithError(
    params: AuthorizationParams,
    error: string,
    description: string,
    res: Response
  ): void {
    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set('error', error);
    redirect.searchParams.set('error_description', description);
    if (params.state != null) {
      redirect.searchParams.set('state', params.state);
    }
    res.redirect(redirect.toString());
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const user = await this.resolveLoggedInUser(res);
    if (user == null) {
      this.redirectToLogin(res);
      return;
    }

    const body = (res.req?.body ?? {}) as Record<string, unknown>;
    const isPost = res.req?.method === 'POST';
    if (isPost && body.consent === 'deny') {
      this.redirectWithError(
        params,
        'access_denied',
        'You denied the request.',
        res
      );
      return;
    }
    const expectedCsrf = computeConsentToken(
      user.sessionToken,
      this.deps.config.consentSecret
    );
    if (
      isPost &&
      body.consent === 'approve' &&
      consentTokenMatches(expectedCsrf, body.csrf)
    ) {
      await this.issueAuthorizationCode(client, params, user.id, res);
      return;
    }

    this.renderConsent(client, params, expectedCsrf, res);
  }

  private renderConsent(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    csrf: string,
    res: Response
  ): void {
    const html = renderConsentPage({
      actionPath: this.deps.config.authorizePath,
      clientName: client.client_name ?? 'An application',
      scopes: params.scopes ?? [],
      csrf,
      fields: {
        client_id: client.client_id,
        redirect_uri: params.redirectUri,
        response_type: 'code',
        code_challenge: params.codeChallenge,
        code_challenge_method: 'S256',
        scope: (params.scopes ?? []).join(' '),
        state: params.state,
        resource: params.resource?.toString(),
      },
    });
    res.set('Content-Type', 'text/html; charset=utf-8').status(200).send(html);
  }

  private async issueAuthorizationCode(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    userId: number,
    res: Response
  ): Promise<void> {
    const code = generateAuthorizationCode();
    const expiresAt = new Date(
      this.now().getTime() + AUTH_CODE_TTL_SECONDS * 1000
    );
    await this.deps.codeRepo.create({
      code_hash: hashSecret(code),
      client_id: client.client_id,
      user_id: userId,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      scopes: params.scopes ?? [],
      resource: params.resource ? canonicalResource(params.resource) : null,
      expires_at: expiresAt,
    });

    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set('code', code);
    if (params.state != null) {
      redirect.searchParams.set('state', params.state);
    }
    res.redirect(redirect.toString());
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const stored = await this.deps.codeRepo.findByHash(
      hashSecret(authorizationCode)
    );
    if (stored == null || stored.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    return stored.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const stored = await this.deps.codeRepo.findByHash(
      hashSecret(authorizationCode)
    );
    if (stored == null || stored.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    if (stored.consumed_at != null) {
      throw new InvalidGrantError('Authorization code already used');
    }
    if (stored.expires_at.getTime() <= this.now().getTime()) {
      throw new InvalidGrantError('Authorization code expired');
    }
    if (redirectUri == null || redirectUri !== stored.redirect_uri) {
      throw new InvalidGrantError('redirect_uri mismatch');
    }
    this.assertResourceMatches(stored.resource, resource);

    const consumed = await this.deps.codeRepo.consume(stored.id, this.now());
    if (!consumed) {
      throw new InvalidGrantError('Authorization code already used');
    }

    return this.issueTokenPair(client.client_id, stored.user_id, stored.scopes);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const stored = await this.deps.tokenRepo.findRefreshTokenByHash(
      hashSecret(refreshToken)
    );
    if (stored == null || stored.client_id !== client.client_id) {
      throw new InvalidGrantError('Invalid refresh token');
    }
    if (stored.revoked_at != null) {
      throw new InvalidGrantError('Refresh token revoked');
    }
    if (stored.expires_at.getTime() <= this.now().getTime()) {
      throw new InvalidGrantError('Refresh token expired');
    }
    this.assertResourceMatches(stored.resource, resource);

    await this.deps.tokenRepo.revokeRefreshTokenByHash(
      hashSecret(refreshToken)
    );
    const nextScopes =
      scopes != null && scopes.length > 0 ? scopes : stored.scopes;
    return this.issueTokenPair(client.client_id, stored.user_id, nextScopes);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const stored = await this.deps.tokenRepo.findAccessTokenByHash(
      hashSecret(token)
    );
    if (stored == null) {
      throw new InvalidTokenError('Invalid access token');
    }
    if (stored.revoked_at != null) {
      throw new InvalidTokenError('Access token revoked');
    }
    const expiresAtMs = stored.expires_at.getTime();
    if (expiresAtMs <= this.now().getTime()) {
      throw new InvalidTokenError('Access token expired');
    }

    const user = await this.deps.usersRepo.getById(String(stored.user_id));
    if (user == null) {
      throw new InvalidTokenError('Access token owner no longer exists');
    }

    return {
      token,
      clientId: stored.client_id,
      scopes: stored.scopes,
      expiresAt: Math.floor(expiresAtMs / 1000),
      resource: new URL(this.deps.config.resourceUrl.toString()),
      extra: { owner: user.id, email: user.email, userId: stored.user_id },
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest
  ): Promise<void> {
    const tokenHash = hashSecret(request.token);
    const access = await this.deps.tokenRepo.findAccessTokenByHash(tokenHash);
    if (access != null && access.client_id === client.client_id) {
      await this.deps.tokenRepo.revokeAccessTokenByHash(tokenHash);
      return;
    }
    const refresh = await this.deps.tokenRepo.findRefreshTokenByHash(tokenHash);
    if (refresh != null && refresh.client_id === client.client_id) {
      await this.deps.tokenRepo.revokeRefreshTokenByHash(tokenHash);
    }
  }

  private assertResourceMatches(
    storedResource: string | null,
    requested?: URL
  ): void {
    const expected = canonicalResource(this.deps.config.resourceUrl);
    if (storedResource != null && storedResource !== expected) {
      throw new ServerError('Token resource does not match this server');
    }
    if (requested != null && canonicalResource(requested) !== expected) {
      throw new InvalidRequestError('resource does not match this server');
    }
  }

  private async issueTokenPair(
    clientId: string,
    userId: number,
    scopes: string[]
  ): Promise<OAuthTokens> {
    const accessToken = generateAccessToken();
    const refreshToken = generateRefreshToken();
    const nowMs = this.now().getTime();
    const resource = canonicalResource(this.deps.config.resourceUrl);
    await this.deps.tokenRepo.createAccessToken({
      token_hash: hashSecret(accessToken),
      client_id: clientId,
      user_id: userId,
      scopes,
      resource,
      expires_at: new Date(nowMs + ACCESS_TOKEN_TTL_SECONDS * 1000),
    });
    await this.deps.tokenRepo.createRefreshToken({
      token_hash: hashSecret(refreshToken),
      client_id: clientId,
      user_id: userId,
      scopes,
      resource,
      expires_at: new Date(nowMs + REFRESH_TOKEN_TTL_SECONDS * 1000),
    });
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    };
  }
}
