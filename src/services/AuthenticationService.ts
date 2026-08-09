import qs from 'querystring';
import crypto from 'crypto';

import axios from 'axios';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

import TokenRepository from '../data_layer/TokenRepository';
import UsersRepository from '../data_layer/UsersRepository';
import Users from '../data_layer/public/Users';
import { Knex } from 'knex';
import instrumentedAxios from './observability/instrumentedAxios';
import { SESSION_JWT_EXPIRY } from '../shared/session';

interface RsaJwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 200);
  }
  return String(error).slice(0, 200);
};

// OAuth token endpoints answer failures with { error, error_description } —
// the part that names the actual cause (invalid_grant vs redirect_uri_mismatch
// vs invalid_client). describeError alone reduces every one of them to
// "AxiosError: Request failed with status code 400", which is what left the
// user_visible_errors context useless for #3952. No secrets live in that body.
const describeTokenExchangeError = (error: unknown): string => {
  if (typeof error === 'object' && error != null && 'response' in error) {
    const response = (
      error as { response?: { status?: number; data?: unknown } }
    ).response;
    if (response != null) {
      const status = `HTTP ${response.status ?? '?'}`;
      const data = response.data;
      if (typeof data === 'object' && data != null) {
        const body = data as Record<string, unknown>;
        const parts = [body.error, body.error_description].filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0
        );
        if (parts.length > 0) {
          return `${status} ${parts.join(': ')}`.slice(0, 300);
        }
      }
      return `${status} ${describeError(error)}`.slice(0, 300);
    }
  }
  return describeError(error).slice(0, 300);
};

const resolveRsaSigningKey = (
  idToken: string,
  jwks: RsaJwk[]
): crypto.KeyObject | null => {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === 'string') {
    return null;
  }
  const { kid, alg } = decoded.header;
  if (alg !== 'RS256' || typeof kid !== 'string') {
    return null;
  }
  const jwk = jwks.find((k) => k.kid === kid);
  if (!jwk) {
    return null;
  }
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
};

const MICROSOFT_JWKS_URL =
  'https://login.microsoftonline.com/common/discovery/v2.0/keys';
const MICROSOFT_JWKS_TTL_MS = 60 * 60 * 1000;
const MICROSOFT_ISSUER_REGEX =
  /^https:\/\/login\.microsoftonline\.com\/[^/]+\/v2\.0$/;
const MICROSOFT_CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

type MicrosoftJwk = RsaJwk;

let cachedMicrosoftJwks: { keys: MicrosoftJwk[]; fetchedAt: number } | null =
  null;

async function getMicrosoftJwks(): Promise<MicrosoftJwk[]> {
  const now = Date.now();
  if (
    cachedMicrosoftJwks &&
    now - cachedMicrosoftJwks.fetchedAt < MICROSOFT_JWKS_TTL_MS
  ) {
    return cachedMicrosoftJwks.keys;
  }
  const result = await instrumentedAxios.get<{ keys: MicrosoftJwk[] }>(
    'microsoft_login',
    MICROSOFT_JWKS_URL
  );
  cachedMicrosoftJwks = { keys: result.data.keys, fetchedAt: now };
  return result.data.keys;
}

export const __resetMicrosoftJwksCacheForTests = () => {
  cachedMicrosoftJwks = null;
};

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_JWKS_TTL_MS = 60 * 60 * 1000;
const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

interface AppleJwk {
  kid: string;
  kty: string;
  alg: string;
  use: string;
  n: string;
  e: string;
  x?: string;
  y?: string;
  crv?: string;
}

let cachedAppleJwks: { keys: AppleJwk[]; fetchedAt: number } | null = null;

async function getAppleJwks(): Promise<AppleJwk[]> {
  const now = Date.now();
  if (cachedAppleJwks && now - cachedAppleJwks.fetchedAt < APPLE_JWKS_TTL_MS) {
    return cachedAppleJwks.keys;
  }
  const result = await instrumentedAxios.get<{ keys: AppleJwk[] }>(
    'apple_login',
    APPLE_JWKS_URL
  );
  cachedAppleJwks = { keys: result.data.keys, fetchedAt: now };
  return result.data.keys;
}

export const __resetAppleJwksCacheForTests = () => {
  cachedAppleJwks = null;
};

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_JWKS_TTL_MS = 60 * 60 * 1000;
const GOOGLE_ISSUERS: [string, ...string[]] = [
  'https://accounts.google.com',
  'accounts.google.com',
];

let cachedGoogleJwks: { keys: RsaJwk[]; fetchedAt: number } | null = null;

async function getGoogleJwks(): Promise<RsaJwk[]> {
  const now = Date.now();
  if (
    cachedGoogleJwks &&
    now - cachedGoogleJwks.fetchedAt < GOOGLE_JWKS_TTL_MS
  ) {
    return cachedGoogleJwks.keys;
  }
  const result = await instrumentedAxios.get<{ keys: RsaJwk[] }>(
    'google_drive',
    GOOGLE_JWKS_URL
  );
  cachedGoogleJwks = { keys: result.data.keys, fetchedAt: now };
  return result.data.keys;
}

export const __resetGoogleJwksCacheForTests = () => {
  cachedGoogleJwks = null;
};

export type GoogleLoginResult =
  | { ok: true; email?: string; name?: string }
  | { ok: false; reason: string; message: string };

export type AppleLoginResult =
  | {
      ok: true;
      subject: string;
      email?: string;
      emailVerified: true;
      refreshToken?: string;
    }
  | { ok: false; reason: string; message: string };

export interface UserWithOwner extends Users {
  owner: number;
}

class AuthenticationService {
  constructor(
    private tokenRepository: TokenRepository,
    private usersRepository: UsersRepository
  ) {}

  isValidToken(token: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!token) {
        resolve(false);
        return;
      }
      try {
        jwt.verify(token, process.env.SECRET!, (error) => {
          resolve(!error);
        });
      } catch {
        resolve(false);
      }
    });
  }

  newResetToken() {
    return crypto.randomBytes(64).toString('hex');
  }

  async isValidResetToken(token: string): Promise<boolean> {
    if (!token || token.length < 128) {
      return false;
    }
    const user = await this.usersRepository.getByResetToken(token);
    return user?.reset_token;
  }

  newJWTToken(userId: number): Promise<string> {
    if (typeof userId !== 'number' || !Number.isFinite(userId)) {
      return Promise.reject(
        new Error('newJWTToken requires a numeric user id')
      );
    }
    return new Promise((resolve, reject) => {
      jwt.sign(
        { userId },
        process.env.SECRET!,
        { expiresIn: SESSION_JWT_EXPIRY },
        (error: Error | null, token: string | undefined) => {
          if (error) {
            reject(error);
          } else if (token) {
            resolve(token);
          } else {
            reject(new Error('Token is undefined'));
          }
        }
      );
    });
  }

  async getUserFrom(token: string): Promise<UserWithOwner | null> {
    const isValid = await this.isValidToken(token);
    if (!isValid) {
      return null;
    }

    const accessToken =
      await this.tokenRepository.getAccessTokenFromString(token);
    if (!accessToken) {
      return null;
    }

    const user = await this.usersRepository.getById(
      accessToken.owner.toString()
    );
    if (!user?.id) {
      return null;
    }
    return { ...user, owner: user.id };
  }

  isNewPasswordValid(resetToken: unknown, password: unknown) {
    return (
      typeof resetToken !== 'string' ||
      resetToken.length === 0 ||
      typeof password !== 'string' ||
      password.length < 8
    );
  }

  logOut(token: string) {
    return this.tokenRepository.deleteAccessToken(token);
  }

  logOutEverywhere(owner: string | number): Promise<number> {
    return this.tokenRepository.deleteAllForOwner(owner.toString());
  }

  async revokeSessionsByResetToken(resetToken: string): Promise<number> {
    const user = await this.usersRepository.getByResetToken(resetToken);
    if (user?.id == null) {
      return 0;
    }
    return this.tokenRepository.deleteAllForOwner(user.id.toString());
  }

  isValidLogin(email: string, password: string) {
    return email && password && password.length >= 8;
  }

  getHashPassword(password: string) {
    return bcrypt.hashSync(password, 12);
  }

  comparePassword(password: string, hash: string): boolean {
    return bcrypt.compareSync(password, hash);
  }

  persistToken(token: string, id: string) {
    return this.tokenRepository.updateAccessToken(token, id);
  }

  async getIsSubscriber(db: Knex, email: string) {
    const linkedEmail = await db('subscriptions')
      .select('active')
      .where({ linked_email: email.toLowerCase() })
      .andWhere({ active: true })
      .first();

    if (linkedEmail?.active) {
      return true;
    }

    const result = await db('subscriptions')
      .select('active')
      .where({ email: email.toLowerCase() })
      .first();

    return result?.active ?? false;
  }

  async getSubscriptionInfo(db: Knex, email: string) {
    const linkedEmail = await db('subscriptions')
      .select(['active', 'email', 'linked_email'])
      .where({ linked_email: email.toLowerCase() })
      .andWhere({ active: true })
      .first();

    if (linkedEmail?.active) {
      return {
        active: true,
        email: linkedEmail.email,
        linked_email: linkedEmail.linked_email,
      };
    }

    const result = await db('subscriptions')
      .select(['active', 'email', 'linked_email'])
      .where({ email: email.toLowerCase() })
      .first();

    return {
      active: result?.active ?? false,
      email: result?.email,
      linked_email: result?.linked_email,
    };
  }

  async loginWithNotion(code: string): Promise<{
    email: string;
    name: string;
    accessData: { [key: string]: string };
  } | null> {
    const clientId = process.env.NOTION_CLIENT_ID;
    const clientSecret = process.env.NOTION_CLIENT_SECRET;
    const redirectUri = process.env.NOTION_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) return null;

    try {
      const result = await instrumentedAxios.post<{ [key: string]: unknown }>(
        'notion',
        'https://api.notion.com/v1/oauth/token',
        { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
        {
          auth: { username: clientId, password: clientSecret },
          headers: { 'Content-Type': 'application/json' },
        }
      );
      const ownerUser = (
        result.data?.owner as {
          user?: { person?: { email?: string }; name?: string };
        }
      )?.user;
      const email = ownerUser?.person?.email;
      const name = ownerUser?.name;
      if (!email) return null;
      return {
        email,
        name: name ?? email.split('@')[0],
        accessData: result.data as { [key: string]: string },
      };
    } catch (error) {
      console.info("Couldn't login with Notion");
      console.error(error);
      return null;
    }
  }

  async loginWithGoogle(code: string): Promise<GoogleLoginResult> {
    const url = 'https://oauth2.googleapis.com/token';
    const values = {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    };

    let idToken: string;
    try {
      const result = await instrumentedAxios.post<{ id_token: string }>(
        'google_drive',
        url,
        qs.stringify(values),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      idToken = result.data.id_token;
    } catch (error) {
      return {
        ok: false,
        reason: 'token_exchange_failed',
        message: describeTokenExchangeError(error),
      };
    }

    try {
      const jwks = await getGoogleJwks();
      const publicKey = resolveRsaSigningKey(idToken, jwks);
      if (!publicKey) {
        return {
          ok: false,
          reason: 'unknown_signing_key',
          message: 'no matching RS256 signing key in Google JWKS',
        };
      }
      const payload = jwt.verify(idToken, publicKey, {
        algorithms: ['RS256'],
        audience: process.env.GOOGLE_CLIENT_ID,
        issuer: GOOGLE_ISSUERS,
      });
      if (typeof payload === 'string') {
        return {
          ok: false,
          reason: 'verify_failed',
          message: 'unexpected string payload',
        };
      }
      const email =
        typeof payload.email === 'string' && payload.email.length > 0
          ? payload.email
          : undefined;
      const name = typeof payload.name === 'string' ? payload.name : undefined;
      return { ok: true, email, name };
    } catch (error) {
      return {
        ok: false,
        reason: 'verify_failed',
        message: describeError(error),
      };
    }
  }

  async loginWithMicrosoft(code: string) {
    const url = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    const values = {
      code,
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      redirect_uri: process.env.MICROSOFT_REDIRECT_URI,
      grant_type: 'authorization_code',
      scope: 'openid profile email offline_access',
    };
    try {
      const result = await instrumentedAxios.post<{ id_token: string }>(
        'microsoft_login',
        url,
        qs.stringify(values),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      const idToken = result.data.id_token;
      const decoded = jwt.decode(idToken, { complete: true });
      if (!decoded || typeof decoded === 'string') {
        return;
      }
      const kid = decoded.header.kid;
      const alg = decoded.header.alg;
      if (alg !== 'RS256' || typeof kid !== 'string') {
        return;
      }
      const jwks = await getMicrosoftJwks();
      const jwk = jwks.find((k) => k.kid === kid);
      if (!jwk) {
        return;
      }
      const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      const payload = jwt.verify(idToken, publicKey, {
        algorithms: ['RS256'],
        audience: process.env.MICROSOFT_CLIENT_ID,
      });
      if (typeof payload === 'string') {
        return;
      }
      if (
        typeof payload.iss !== 'string' ||
        !MICROSOFT_ISSUER_REGEX.test(payload.iss)
      ) {
        console.info("Couldn't login with Microsoft: unexpected issuer");
        return;
      }
      const subject = typeof payload.sub === 'string' ? payload.sub : undefined;
      if (!subject) {
        console.info("Couldn't login with Microsoft: missing sub claim");
        return;
      }
      const email =
        typeof payload.email === 'string' && payload.email.length > 0
          ? payload.email
          : undefined;
      const isPersonalMsa =
        typeof payload.tid === 'string' &&
        payload.tid === MICROSOFT_CONSUMER_TENANT_ID;
      const emailVerified =
        isPersonalMsa ||
        payload.email_verified === true ||
        (payload as { xms_edov?: unknown }).xms_edov === true;
      const name = typeof payload.name === 'string' ? payload.name : undefined;
      return { subject, email, name, emailVerified };
    } catch (error) {
      console.info("Couldn't login with Microsoft");
      console.error(error);
    }
  }

  mintAppleClientSecret(): string {
    const teamId = process.env.APPLE_TEAM_ID;
    const clientId = process.env.APPLE_CLIENT_ID;
    const keyId = process.env.APPLE_KEY_ID;
    const privateKeyB64 = process.env.APPLE_PRIVATE_KEY_B64;
    if (!teamId || !clientId || !keyId || !privateKeyB64) {
      throw new Error('Apple OAuth env vars are not configured');
    }
    const privateKeyPem = Buffer.from(privateKeyB64, 'base64').toString('utf8');
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iss: teamId,
        iat: now,
        exp: now + 86400,
        aud: APPLE_ISSUER,
        sub: clientId,
      },
      privateKeyPem.replace(/\\n/g, '\n'),
      { algorithm: 'ES256', header: { alg: 'ES256', kid: keyId } }
    );
  }

  async loginWithApple(code: string): Promise<AppleLoginResult> {
    const clientId = process.env.APPLE_CLIENT_ID;
    const APPLE_REDIRECT_URI = `${process.env.DOMAIN ?? 'https://2anki.net'}/auth/apple/callback`;
    if (!clientId) {
      return {
        ok: false,
        reason: 'not_configured',
        message: 'APPLE_CLIENT_ID is not set',
      };
    }

    let idToken: string;
    let refreshToken: string | undefined;
    try {
      const clientSecret = this.mintAppleClientSecret();
      const values = {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: APPLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      };
      const result = await instrumentedAxios.post<{
        id_token: string;
        refresh_token?: string;
        access_token?: string;
      }>('apple_login', APPLE_TOKEN_URL, qs.stringify(values), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      idToken = result.data.id_token;
      refreshToken =
        typeof result.data.refresh_token === 'string'
          ? result.data.refresh_token
          : undefined;
    } catch (error) {
      return {
        ok: false,
        reason: 'token_exchange_failed',
        message: describeTokenExchangeError(error),
      };
    }

    try {
      const decoded = jwt.decode(idToken, { complete: true });
      if (!decoded || typeof decoded === 'string') {
        return {
          ok: false,
          reason: 'verify_failed',
          message: 'id_token did not decode to a JWT object',
        };
      }
      const kid = decoded.header.kid;
      const alg = decoded.header.alg;
      if (alg !== 'RS256' || typeof kid !== 'string') {
        return {
          ok: false,
          reason: 'verify_failed',
          message: `unexpected id_token header alg=${String(alg)}`,
        };
      }
      const jwks = await getAppleJwks();
      const jwk = jwks.find((k) => k.kid === kid);
      if (!jwk) {
        return {
          ok: false,
          reason: 'verify_failed',
          message: 'no matching signing key in Apple JWKS',
        };
      }
      const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      const payload = jwt.verify(idToken, publicKey, {
        algorithms: ['RS256'],
        audience: clientId,
        issuer: APPLE_ISSUER,
      });
      if (typeof payload === 'string') {
        return {
          ok: false,
          reason: 'verify_failed',
          message: 'unexpected string payload',
        };
      }
      const subject = typeof payload.sub === 'string' ? payload.sub : undefined;
      if (!subject) {
        return {
          ok: false,
          reason: 'missing_sub',
          message: 'id_token payload has no sub claim',
        };
      }
      const emailVerified =
        payload.email_verified === true || payload.email_verified === 'true';
      if (!emailVerified) {
        return {
          ok: false,
          reason: 'email_not_verified',
          message: 'Apple reports the email as unverified',
        };
      }
      const email =
        typeof payload.email === 'string' && payload.email.length > 0
          ? payload.email
          : undefined;
      return {
        ok: true,
        subject,
        email,
        emailVerified: true as const,
        refreshToken,
      };
    } catch (error) {
      return {
        ok: false,
        reason: 'verify_failed',
        message: describeError(error),
      };
    }
  }

  async revokeAppleToken(refreshToken: string): Promise<boolean> {
    const clientId = process.env.APPLE_CLIENT_ID;
    if (!clientId) {
      return false;
    }
    try {
      const clientSecret = this.mintAppleClientSecret();
      const values = {
        client_id: clientId,
        client_secret: clientSecret,
        token: refreshToken,
        token_type_hint: 'refresh_token',
      };
      await instrumentedAxios.post(
        'apple_login',
        APPLE_REVOKE_URL,
        qs.stringify(values),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
      return true;
    } catch (error) {
      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      if (status === 400 || status === 401) {
        return true;
      }
      console.info("Couldn't revoke Apple token", {
        status: status ?? 'unknown',
      });
      return false;
    }
  }

  async verifyAppleIdentityToken(
    idToken: string
  ): Promise<{ subject: string; email?: string } | undefined> {
    const audience = process.env.APPLE_NATIVE_CLIENT_ID;
    if (!audience) {
      return undefined;
    }
    try {
      const decoded = jwt.decode(idToken, { complete: true });
      if (!decoded || typeof decoded === 'string') {
        return undefined;
      }
      const kid = decoded.header.kid;
      const alg = decoded.header.alg;
      if (alg !== 'RS256' || typeof kid !== 'string') {
        return undefined;
      }
      const jwks = await getAppleJwks();
      const jwk = jwks.find((k) => k.kid === kid);
      if (!jwk) {
        return undefined;
      }
      const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      const payload = jwt.verify(idToken, publicKey, {
        algorithms: ['RS256'],
        audience,
        issuer: APPLE_ISSUER,
      });
      if (typeof payload === 'string') {
        return undefined;
      }
      const subject = typeof payload.sub === 'string' ? payload.sub : undefined;
      if (!subject) {
        return undefined;
      }
      const email =
        typeof payload.email === 'string' && payload.email.length > 0
          ? payload.email
          : undefined;
      return { subject, email };
    } catch {
      return undefined;
    }
  }
}

export default AuthenticationService;
