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
  InvalidTargetError,
  InvalidTokenError,
  OAuthError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';

import AuthenticationService from '../../AuthenticationService';
import { trackingAllowedFor } from '../../../lib/http/consentRegion';
import {
  asMcpAuthorizeReturn,
  rememberMcpLoginReturn,
  takeMcpLoginReturn,
} from '../../../lib/mcp/loginReturn';
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
import { assertValidRedirectUris } from './redirectUris';
import {
  ClientMetadataDocumentError,
  ClientMetadataDocumentResolver,
  isCimdStorageId,
  isClientMetadataDocumentId,
  storageClientIdFor,
} from './clientMetadataDocument';

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
  clientMetadataResolver?: ClientMetadataDocumentResolver;
}

// The SDK's token handler answers a non-OAuth error or a ServerError with a
// bare 500 and logs nothing, so this is the only record of one.
async function logUnexpectedTokenFailure<T>(
  grantType: string,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof OAuthError) || error instanceof ServerError) {
      console.error('[mcp-oauth] token exchange failed', {
        grantType,
        errorClass:
          error instanceof Error ? error.constructor.name : typeof error,
      });
    }
    throw error;
  }
}

function canonicalResource(value: URL): string {
  const url = new URL(value.toString());
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

class KnexClientsStore implements OAuthRegisteredClientsStore {
  constructor(
    private readonly clientRepo: IMcpOAuthClientRepository,
    private readonly metadataResolver: ClientMetadataDocumentResolver
  ) {}

  async getClient(
    clientId: string
  ): Promise<OAuthClientInformationFull | undefined> {
    if (isClientMetadataDocumentId(clientId)) {
      return this.resolveMetadataDocument(clientId);
    }
    if (isCimdStorageId(clientId)) {
      return undefined;
    }
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

  private async resolveMetadataDocument(
    clientId: string
  ): Promise<OAuthClientInformationFull | undefined> {
    try {
      return await this.metadataResolver.resolve(clientId);
    } catch (error) {
      if (error instanceof ClientMetadataDocumentError) {
        console.warn(
          `[mcp-oauth] rejected client metadata document (${error.reason}): ${error.message}`
        );
        return undefined;
      }
      throw error;
    }
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
    this.store = new KnexClientsStore(
      deps.clientRepo,
      deps.clientMetadataResolver ?? new ClientMetadataDocumentResolver()
    );
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
    const req = res.req;
    const originalUrl = req?.originalUrl ?? '';
    const cookies = req?.cookies as Record<string, unknown> | undefined;
    if (
      req != null &&
      cookies?.first_touch == null &&
      trackingAllowedFor(req)
    ) {
      res.cookie('first_touch', JSON.stringify({ landingPath: '/mcp' }), {
        httpOnly: false,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 30,
      });
    }
    // The web login reads `redirect`; the cookie covers the sign-in methods
    // that leave the site (Google, Microsoft, Apple, Notion) and come back
    // without it. Only a GET carries its authorize parameters in the URL, so
    // only a GET can be resumed from it.
    const returnTo =
      req?.method === 'GET' ? asMcpAuthorizeReturn(originalUrl) : undefined;
    if (returnTo == null) {
      res.redirect(this.deps.config.loginPath);
      return;
    }
    rememberMcpLoginReturn(res, returnTo);
    res.redirect(
      `${this.deps.config.loginPath}?redirect=${encodeURIComponent(returnTo)}`
    );
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
    if (params.resource != null && !this.isOwnResource(params.resource)) {
      throw new InvalidTargetError('resource does not match this server');
    }
    const user = await this.resolveLoggedInUser(res);
    if (user == null) {
      this.redirectToLogin(res);
      return;
    }
    // Back at authorize signed in: the remembered return has done its job,
    // whichever way the user got here (including a fresh registration).
    if (res.req != null) {
      takeMcpLoginReturn(res.req, res);
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
      redirectUri: params.redirectUri,
      clientHost: isClientMetadataDocumentId(client.client_id)
        ? new URL(client.client_id).host
        : undefined,
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
    const clientId = await this.storedClientIdFor(client);
    const code = generateAuthorizationCode();
    const expiresAt = new Date(
      this.now().getTime() + AUTH_CODE_TTL_SECONDS * 1000
    );
    await this.deps.codeRepo.create({
      code_hash: hashSecret(code),
      client_id: clientId,
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
    if (
      stored == null ||
      stored.client_id !== storageClientIdFor(client.client_id)
    ) {
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
    return logUnexpectedTokenFailure('authorization_code', () =>
      this.redeemAuthorizationCode(
        client,
        authorizationCode,
        redirectUri,
        resource
      )
    );
  }

  private async redeemAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const stored = await this.deps.codeRepo.findByHash(
      hashSecret(authorizationCode)
    );
    if (
      stored == null ||
      stored.client_id !== storageClientIdFor(client.client_id)
    ) {
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

    return this.issueTokenPair(stored.client_id, stored.user_id, stored.scopes);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    return logUnexpectedTokenFailure('refresh_token', () =>
      this.redeemRefreshToken(client, refreshToken, scopes, resource)
    );
  }

  private async redeemRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const stored = await this.deps.tokenRepo.findRefreshTokenByHash(
      hashSecret(refreshToken)
    );
    if (
      stored == null ||
      stored.client_id !== storageClientIdFor(client.client_id)
    ) {
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
    return this.issueTokenPair(stored.client_id, stored.user_id, nextScopes);
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
    const clientId = storageClientIdFor(client.client_id);
    const access = await this.deps.tokenRepo.findAccessTokenByHash(tokenHash);
    if (access != null && access.client_id === clientId) {
      await this.deps.tokenRepo.revokeAccessTokenByHash(tokenHash);
      return;
    }
    const refresh = await this.deps.tokenRepo.findRefreshTokenByHash(tokenHash);
    if (refresh != null && refresh.client_id === clientId) {
      await this.deps.tokenRepo.revokeRefreshTokenByHash(tokenHash);
    }
  }

  // CIMD clients have no registration row, but the code and token tables
  // reference mcp_oauth_clients. Upsert one row per metadata document URL
  // (not per connection) under its storage id before the first code is
  // written; later authorizations refresh its name and redirect URIs.
  private async storedClientIdFor(
    client: OAuthClientInformationFull
  ): Promise<string> {
    const clientId = storageClientIdFor(client.client_id);
    if (clientId === client.client_id) {
      return clientId;
    }
    await this.deps.clientRepo.upsert({
      client_id: clientId,
      client_name: client.client_name ?? null,
      redirect_uris: client.redirect_uris,
      grant_types: client.grant_types ?? [
        'authorization_code',
        'refresh_token',
      ],
      response_types: client.response_types ?? ['code'],
      scope: client.scope ?? null,
      token_endpoint_auth_method: 'none',
      metadata: { client_id_metadata_document: client.client_id },
      client_id_issued_at: Math.floor(this.now().getTime() / 1000),
    });
    return clientId;
  }

  private isOwnResource(resource: URL): boolean {
    return (
      canonicalResource(resource) ===
      canonicalResource(this.deps.config.resourceUrl)
    );
  }

  private assertResourceMatches(
    storedResource: string | null,
    requested?: URL
  ): void {
    const expected = canonicalResource(this.deps.config.resourceUrl);
    if (storedResource != null && storedResource !== expected) {
      throw new InvalidTargetError('resource does not match this server');
    }
    if (requested != null && !this.isOwnResource(requested)) {
      throw new InvalidTargetError('resource does not match this server');
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
