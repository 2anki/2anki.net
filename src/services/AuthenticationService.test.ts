import crypto from 'crypto';

import jwt from 'jsonwebtoken';
import knex, { Knex } from 'knex';

import AuthenticationService, {
  __resetMicrosoftJwksCacheForTests,
  __resetAppleJwksCacheForTests,
  __resetGoogleJwksCacheForTests,
} from './AuthenticationService';
import TokenRepository from '../data_layer/TokenRepository';
import UsersRepository from '../data_layer/UsersRepository';
import { SESSION_MAX_AGE_MS } from '../shared/session';
import instrumentedAxios from './observability/instrumentedAxios';

jest.mock('./observability/instrumentedAxios');

const SECRET = 'test-secret';

beforeAll(() => {
  process.env.SECRET = SECRET;
  process.env.NOTION_CLIENT_ID = 'test-client-id';
  process.env.NOTION_CLIENT_SECRET = 'test-client-secret';
  process.env.NOTION_REDIRECT_URI = 'http://localhost:2020/api/notion/connect';
});

const mockedAxios = instrumentedAxios as jest.Mocked<typeof instrumentedAxios>;

function createService() {
  const tokenRepo = {} as TokenRepository;
  const usersRepo = {} as UsersRepository;
  return new AuthenticationService(tokenRepo, usersRepo);
}

test('newJWTToken includes an expiration claim', async () => {
  const service = createService();
  const token = await service.newJWTToken(42);
  const decoded = jwt.decode(token) as jwt.JwtPayload;

  expect(decoded.exp).toBeDefined();
  expect(decoded.iat).toBeDefined();
  expect(decoded.exp! - decoded.iat!).toBe(SESSION_MAX_AGE_MS / 1000);
});

test('newJWTToken payload carries only the numeric user id', async () => {
  const service = createService();
  const token = await service.newJWTToken(42);
  const decoded = jwt.decode(token) as jwt.JwtPayload;

  expect(decoded.userId).toBe(42);
  expect(decoded).not.toHaveProperty('password');
  expect(decoded).not.toHaveProperty('email');
  // guards against a caller passing the whole user row (leaks the hash + PII
  // and overflows the access_tokens btree index)
  expect(Object.keys(decoded).sort()).toEqual(['exp', 'iat', 'userId']);
});

test('newJWTToken rejects a non-numeric user id', async () => {
  const service = createService();
  await expect(
    service.newJWTToken({ id: 42, password: 'hash' } as unknown as number)
  ).rejects.toThrow('numeric user id');
});

describe('isValidToken', () => {
  it('resolves true for a freshly signed token', async () => {
    const service = createService();
    const token = jwt.sign({ userId: 1 }, SECRET, { expiresIn: '1h' });

    await expect(service.isValidToken(token)).resolves.toBe(true);
  });

  it('resolves false for an expired token (no throw)', async () => {
    const service = createService();
    const token = jwt.sign({ userId: 1 }, SECRET, { expiresIn: '0s' });

    await expect(service.isValidToken(token)).resolves.toBe(false);
  });

  it('resolves false for a token signed with a different secret', async () => {
    const service = createService();
    const token = jwt.sign({ userId: 1 }, 'a-different-secret', {
      expiresIn: '1h',
    });

    await expect(service.isValidToken(token)).resolves.toBe(false);
  });

  it('resolves false for a malformed token string', async () => {
    const service = createService();

    await expect(service.isValidToken('not-a-jwt')).resolves.toBe(false);
  });

  it('resolves false for an empty token', async () => {
    const service = createService();

    await expect(service.isValidToken('')).resolves.toBe(false);
  });
});

describe('loginWithNotion', () => {
  const notionResponse = {
    access_token: 'secret-token',
    token_type: 'bearer',
    bot_id: 'bot-123',
    workspace_name: 'My Workspace',
    workspace_icon: null,
    workspace_id: 'ws-123',
    owner: {
      user: {
        name: 'Alice',
        person: { email: 'alice@example.com' },
      },
    },
  };

  it('returns email, name, and accessData on success', async () => {
    mockedAxios.post = jest.fn().mockResolvedValue({ data: notionResponse });

    const service = createService();
    const result = await service.loginWithNotion('auth-code');

    expect(result).toEqual({
      email: 'alice@example.com',
      name: 'Alice',
      accessData: notionResponse,
    });
  });

  it('falls back to email prefix as name when name is absent', async () => {
    const responseWithoutName = {
      ...notionResponse,
      owner: { user: { person: { email: 'bob@example.com' } } },
    };
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: responseWithoutName });

    const service = createService();
    const result = await service.loginWithNotion('auth-code');

    expect(result?.name).toBe('bob');
    expect(result?.email).toBe('bob@example.com');
  });

  it('returns null when Notion response has no email', async () => {
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: { access_token: 'tok', owner: { user: { person: {} } } },
    });

    const service = createService();
    const result = await service.loginWithNotion('auth-code');

    expect(result).toBeNull();
  });

  it('returns null when the Notion API call throws', async () => {
    mockedAxios.post = jest.fn().mockRejectedValue(new Error('network error'));

    const service = createService();
    const result = await service.loginWithNotion('auth-code');

    expect(result).toBeNull();
  });

  it('returns null when NOTION_CLIENT_ID is not set', async () => {
    const originalId = process.env.NOTION_CLIENT_ID;
    delete process.env.NOTION_CLIENT_ID;

    const service = createService();
    const result = await service.loginWithNotion('auth-code');

    process.env.NOTION_CLIENT_ID = originalId;
    expect(result).toBeNull();
  });
});

describe('loginWithGoogle', () => {
  const KID = 'google-key-id-001';
  const CLIENT_ID = 'test-google-client-id';
  let privateKey: crypto.KeyObject;
  let publicJwk: {
    kid: string;
    kty: string;
    n: string;
    e: string;
    alg: string;
  };

  const signIdToken = (payload: Record<string, unknown>): string =>
    jwt.sign(payload, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      algorithm: 'RS256',
      header: { alg: 'RS256', kid: KID },
    });

  beforeAll(() => {
    const { privateKey: priv, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    privateKey = priv;
    const jwk = publicKey.export({ format: 'jwk' });
    publicJwk = {
      kid: KID,
      kty: jwk.kty as string,
      n: jwk.n as string,
      e: jwk.e as string,
      alg: 'RS256',
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    __resetGoogleJwksCacheForTests();
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:2020/api/auth/google';
    mockedAxios.get = jest.fn().mockResolvedValue({
      data: { keys: [publicJwk] },
    });
  });

  it('returns email and name when the ID token is valid', async () => {
    const idToken = signIdToken({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google-sub-001',
      email: 'user@example.com',
      name: 'Test User',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithGoogle('auth-code');

    expect(result).toEqual({
      ok: true,
      email: 'user@example.com',
      name: 'Test User',
    });
  });

  it('fetches the Google JWKS through instrumentedAxios', async () => {
    const idToken = signIdToken({
      iss: 'accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google-sub-002',
      email: 'user@example.com',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    await service.loginWithGoogle('auth-code');

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'google_drive',
      'https://www.googleapis.com/oauth2/v3/certs'
    );
  });

  it('captures the provider error body when the token exchange fails', async () => {
    const axiosError = Object.assign(
      new Error('Request failed with status code 400'),
      {
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            error: 'invalid_grant',
            error_description: 'Bad authorization code.',
          },
        },
      }
    );
    mockedAxios.post = jest.fn().mockRejectedValue(axiosError);

    const service = createService();
    const result = await service.loginWithGoogle('auth-code');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('token_exchange_failed');
      expect(result.message).toContain('400');
      expect(result.message).toContain('invalid_grant');
      expect(result.message).toContain('Bad authorization code.');
    }
  });

  it('returns a failure reason when the ID token signature is invalid', async () => {
    const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const idToken = jwt.sign(
      {
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: 'google-sub-003',
        email: 'user@example.com',
      },
      otherKey.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', header: { alg: 'RS256', kid: KID } }
    );
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithGoogle('auth-code');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('verify_failed');
      expect(typeof result.message).toBe('string');
      expect(result.message.length).toBeGreaterThan(0);
    }
  });

  it('returns a failure reason when the audience does not match the client id', async () => {
    const idToken = signIdToken({
      iss: 'https://accounts.google.com',
      aud: 'a-different-app',
      sub: 'google-sub-004',
      email: 'user@example.com',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithGoogle('auth-code');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('verify_failed');
    }
  });

  it('returns a failure reason when the issuer is not Google', async () => {
    const idToken = signIdToken({
      iss: 'https://evil.example.com',
      aud: CLIENT_ID,
      sub: 'google-sub-005',
      email: 'user@example.com',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithGoogle('auth-code');

    expect(result.ok).toBe(false);
  });

  it('returns a failure reason when the kid is not in the JWKS', async () => {
    const idToken = jwt.sign(
      {
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: 'google-sub-006',
        email: 'user@example.com',
      },
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', header: { alg: 'RS256', kid: 'unknown-kid' } }
    );
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithGoogle('auth-code');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unknown_signing_key');
    }
  });

  it('returns a failure reason when the JWKS fetch fails', async () => {
    const idToken = signIdToken({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'google-sub-007',
      email: 'user@example.com',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });
    mockedAxios.get = jest.fn().mockRejectedValue(new Error('jwks down'));

    const service = createService();
    const result = await service.loginWithGoogle('auth-code');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('verify_failed');
    }
  });

  it('returns a failure reason when the token exchange call fails', async () => {
    mockedAxios.post = jest.fn().mockRejectedValue(new Error('invalid_grant'));

    const service = createService();
    const result = await service.loginWithGoogle('auth-code');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('token_exchange_failed');
    }
  });

  it('rejects an ES256-signed id_token (algorithm substitution defense)', async () => {
    const ecPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const ecPublicJwk = {
      ...(ecPair.publicKey.export({ format: 'jwk' }) as Record<
        string,
        unknown
      >),
      kid: KID,
      alg: 'ES256',
      use: 'sig',
    };
    mockedAxios.get = jest
      .fn()
      .mockResolvedValue({ data: { keys: [ecPublicJwk] } });
    const idToken = jwt.sign(
      {
        iss: 'https://accounts.google.com',
        aud: CLIENT_ID,
        sub: 'google-sub-008',
        email: 'user@example.com',
      },
      ecPair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'ES256', header: { alg: 'ES256', kid: KID } }
    );
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithGoogle('auth-code');

    expect(result.ok).toBe(false);
  });
});

describe('loginWithMicrosoft', () => {
  const KID = 'test-key-id';
  const CLIENT_ID = 'test-microsoft-client-id';
  let privateKey: crypto.KeyObject;
  let publicJwk: {
    kid: string;
    kty: string;
    n: string;
    e: string;
    alg: string;
  };

  const signIdToken = (payload: Record<string, unknown>): string =>
    jwt.sign(payload, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      algorithm: 'RS256',
      header: { alg: 'RS256', kid: KID },
    });

  beforeAll(() => {
    const { privateKey: priv, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    privateKey = priv;
    const jwk = publicKey.export({ format: 'jwk' });
    publicJwk = {
      kid: KID,
      kty: jwk.kty as string,
      n: jwk.n as string,
      e: jwk.e as string,
      alg: 'RS256',
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    __resetMicrosoftJwksCacheForTests();
    process.env.MICROSOFT_CLIENT_ID = CLIENT_ID;
    process.env.MICROSOFT_CLIENT_SECRET = 'test-microsoft-client-secret';
    process.env.MICROSOFT_REDIRECT_URI =
      'http://localhost:2020/api/users/auth/microsoft';
    mockedAxios.get = jest.fn().mockResolvedValue({
      data: { keys: [publicJwk] },
    });
  });

  it('returns subject, email, name, and emailVerified=true when xms_edov is true', async () => {
    const idToken = signIdToken({
      iss: 'https://login.microsoftonline.com/common/v2.0',
      aud: CLIENT_ID,
      sub: 'ms-subject-001',
      email: 'user@outlook.com',
      xms_edov: true,
      name: 'Microsoft User',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithMicrosoft('auth-code');

    expect(result).toEqual({
      subject: 'ms-subject-001',
      email: 'user@outlook.com',
      name: 'Microsoft User',
      emailVerified: true,
    });
  });

  it('treats email_verified=true the same as xms_edov=true', async () => {
    const idToken = signIdToken({
      iss: 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0',
      aud: CLIENT_ID,
      sub: 'ms-subject-002',
      email: 'alice@contoso.com',
      email_verified: true,
      name: 'Alice',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithMicrosoft('auth-code');

    expect(result).toEqual({
      subject: 'ms-subject-002',
      email: 'alice@contoso.com',
      name: 'Alice',
      emailVerified: true,
    });
  });

  it('returns emailVerified=false when a work/school token carries neither xms_edov nor email_verified', async () => {
    const idToken = signIdToken({
      iss: 'https://login.microsoftonline.com/common/v2.0',
      aud: CLIENT_ID,
      sub: 'ms-subject-003',
      tid: 'some-org-tenant-id',
      email: 'maybe@example.com',
      name: 'Bob',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithMicrosoft('auth-code');

    expect(result).toEqual({
      subject: 'ms-subject-003',
      email: 'maybe@example.com',
      name: 'Bob',
      emailVerified: false,
    });
  });

  it('treats personal MSA tokens (consumer tenant id) as verified-by-default', async () => {
    const idToken = signIdToken({
      iss: 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0',
      aud: CLIENT_ID,
      sub: 'ms-subject-msa',
      tid: '9188040d-6c67-4c5b-b112-36a304b66dad',
      email: 'msa-user@hotmail.com',
      name: 'MSA User',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithMicrosoft('auth-code');

    expect(result).toEqual({
      subject: 'ms-subject-msa',
      email: 'msa-user@hotmail.com',
      name: 'MSA User',
      emailVerified: true,
    });
  });

  it('returns email as undefined when the email claim is missing', async () => {
    const idToken = signIdToken({
      iss: 'https://login.microsoftonline.com/common/v2.0',
      aud: CLIENT_ID,
      sub: 'ms-subject-004',
      xms_edov: true,
      name: 'No Email User',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithMicrosoft('auth-code');

    expect(result).toEqual({
      subject: 'ms-subject-004',
      email: undefined,
      name: 'No Email User',
      emailVerified: true,
    });
  });

  it('returns undefined when the sub claim is missing', async () => {
    const idToken = signIdToken({
      iss: 'https://login.microsoftonline.com/common/v2.0',
      aud: CLIENT_ID,
      email: 'user@outlook.com',
      xms_edov: true,
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithMicrosoft('auth-code');

    expect(result).toBeUndefined();
  });

  it('returns undefined when the iss claim is not a Microsoft issuer', async () => {
    const idToken = signIdToken({
      iss: 'https://evil.example.com/v2.0',
      aud: CLIENT_ID,
      email: 'user@outlook.com',
      name: 'User',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithMicrosoft('auth-code');

    expect(result).toBeUndefined();
  });

  it('returns undefined when the ID token signature is invalid', async () => {
    const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const idToken = jwt.sign(
      {
        iss: 'https://login.microsoftonline.com/common/v2.0',
        aud: CLIENT_ID,
        email: 'user@outlook.com',
      },
      otherKey.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', header: { alg: 'RS256', kid: KID } }
    );
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithMicrosoft('auth-code');

    expect(result).toBeUndefined();
  });

  it('returns undefined when the audience does not match the client id', async () => {
    const idToken = signIdToken({
      iss: 'https://login.microsoftonline.com/common/v2.0',
      aud: 'a-different-app',
      email: 'user@outlook.com',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithMicrosoft('auth-code');

    expect(result).toBeUndefined();
  });

  it('returns undefined when the kid is not found in the JWKS', async () => {
    const idToken = jwt.sign(
      {
        iss: 'https://login.microsoftonline.com/common/v2.0',
        aud: CLIENT_ID,
        email: 'user@outlook.com',
      },
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', header: { alg: 'RS256', kid: 'unknown-kid' } }
    );
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithMicrosoft('auth-code');

    expect(result).toBeUndefined();
  });

  it('returns undefined when the token exchange call fails', async () => {
    mockedAxios.post = jest.fn().mockRejectedValue(new Error('network error'));

    const service = createService();
    const result = await service.loginWithMicrosoft('auth-code');

    expect(result).toBeUndefined();
  });
});

describe('mintAppleClientSecret', () => {
  const TEAM_ID = 'TEAMID1234';
  const SERVICES_ID = 'com.example.2anki';
  const KEY_ID = 'KEYID56789';
  let privateKeyPem: string;
  let privateKeyB64: string;

  beforeAll(() => {
    const { privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    privateKeyPem = privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    privateKeyB64 = Buffer.from(privateKeyPem).toString('base64');
  });

  beforeEach(() => {
    process.env.APPLE_TEAM_ID = TEAM_ID;
    process.env.APPLE_CLIENT_ID = SERVICES_ID;
    process.env.APPLE_KEY_ID = KEY_ID;
    process.env.APPLE_PRIVATE_KEY_B64 = privateKeyB64;
  });

  it('produces a JWT with alg=ES256 and the correct claims', () => {
    const service = createService();
    const token = service.mintAppleClientSecret();
    const decoded = jwt.decode(token, { complete: true }) as jwt.Jwt;

    expect(decoded.header.alg).toBe('ES256');
    expect(decoded.header.kid).toBe(KEY_ID);
    const payload = decoded.payload as jwt.JwtPayload;
    expect(payload.iss).toBe(TEAM_ID);
    expect(payload.sub).toBe(SERVICES_ID);
    expect(payload.aud).toBe('https://appleid.apple.com');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp! - payload.iat!).toBeLessThanOrEqual(86400);
  });

  it('decodes APPLE_PRIVATE_KEY_B64 from base64 before signing', () => {
    const service = createService();
    const token = service.mintAppleClientSecret();
    const decoded = jwt.decode(token, { complete: true }) as jwt.Jwt;
    expect(decoded.header.alg).toBe('ES256');
  });

  it('throws when APPLE_PRIVATE_KEY_B64 is missing', () => {
    delete process.env.APPLE_PRIVATE_KEY_B64;
    const service = createService();
    expect(() => service.mintAppleClientSecret()).toThrow(
      'Apple OAuth env vars are not configured'
    );
  });

  it('throws when any required env var is missing', () => {
    delete process.env.APPLE_TEAM_ID;
    const service = createService();
    expect(() => service.mintAppleClientSecret()).toThrow();
  });
});

describe('loginWithApple', () => {
  const SERVICES_ID = 'com.example.2anki';
  const KID = 'apple-key-001';
  let privateKey: crypto.KeyObject;
  let publicJwk: Record<string, unknown>;

  const signIdToken = (payload: Record<string, unknown>): string =>
    jwt.sign(payload, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      algorithm: 'RS256',
      header: { alg: 'RS256', kid: KID },
    });

  beforeAll(() => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    publicJwk = pair.publicKey.export({ format: 'jwk' }) as Record<
      string,
      unknown
    >;
    publicJwk['kid'] = KID;
    publicJwk['alg'] = 'RS256';
    publicJwk['use'] = 'sig';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    __resetAppleJwksCacheForTests();
    process.env.APPLE_CLIENT_ID = SERVICES_ID;
    process.env.APPLE_TEAM_ID = 'TEAMID1234';
    process.env.APPLE_KEY_ID = 'KEYID56789';
    const { privateKey: sk } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    process.env.APPLE_PRIVATE_KEY_B64 = Buffer.from(
      sk.export({ type: 'pkcs8', format: 'pem' }) as string
    ).toString('base64');
    mockedAxios.get = jest
      .fn()
      .mockResolvedValue({ data: { keys: [publicJwk] } });
  });

  it('returns subject and email when id_token is valid', async () => {
    const idToken = signIdToken({
      iss: 'https://appleid.apple.com',
      aud: SERVICES_ID,
      sub: 'apple-sub-001',
      email: 'user@example.com',
      email_verified: true,
    });
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: { id_token: idToken, refresh_token: 'apple-refresh-001' },
    });

    const service = createService();
    const result = await service.loginWithApple('auth-code');

    expect(result).toEqual({
      ok: true,
      subject: 'apple-sub-001',
      email: 'user@example.com',
      emailVerified: true,
      refreshToken: 'apple-refresh-001',
    });
  });

  it('returns refreshToken undefined when Apple omits one', async () => {
    const idToken = signIdToken({
      iss: 'https://appleid.apple.com',
      aud: SERVICES_ID,
      sub: 'apple-sub-001b',
      email: 'user@example.com',
      email_verified: true,
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithApple('auth-code');

    expect(result).toMatchObject({
      ok: true,
      subject: 'apple-sub-001b',
      refreshToken: undefined,
    });
  });

  it('accepts email_verified as the string "true"', async () => {
    const idToken = signIdToken({
      iss: 'https://appleid.apple.com',
      aud: SERVICES_ID,
      sub: 'apple-sub-002',
      email: 'hidden@privaterelay.appleid.com',
      email_verified: 'true',
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithApple('auth-code');

    expect(result).toMatchObject({
      ok: true,
      subject: 'apple-sub-002',
      emailVerified: true,
    });
  });

  it('fails with email_not_verified when email_verified is false', async () => {
    const idToken = signIdToken({
      iss: 'https://appleid.apple.com',
      aud: SERVICES_ID,
      sub: 'apple-sub-003',
      email: 'user@example.com',
      email_verified: false,
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithApple('auth-code');

    expect(result).toMatchObject({ ok: false, reason: 'email_not_verified' });
  });

  it('fails with verify_failed when the issuer is wrong', async () => {
    const idToken = signIdToken({
      iss: 'https://evil.example.com',
      aud: SERVICES_ID,
      sub: 'apple-sub-004',
      email: 'user@example.com',
      email_verified: true,
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithApple('auth-code');

    expect(result).toMatchObject({ ok: false, reason: 'verify_failed' });
  });

  it('fails with verify_failed when the audience does not match', async () => {
    const idToken = signIdToken({
      iss: 'https://appleid.apple.com',
      aud: 'com.evil.app',
      sub: 'apple-sub-005',
      email: 'user@example.com',
      email_verified: true,
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithApple('auth-code');

    expect(result).toMatchObject({ ok: false, reason: 'verify_failed' });
  });

  it('fails with verify_failed when the signature is invalid', async () => {
    const wrongPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const idToken = jwt.sign(
      {
        iss: 'https://appleid.apple.com',
        aud: SERVICES_ID,
        sub: 'apple-sub-006',
        email: 'user@example.com',
        email_verified: true,
      },
      wrongPair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', header: { alg: 'RS256', kid: KID } }
    );
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithApple('auth-code');

    expect(result).toMatchObject({ ok: false, reason: 'verify_failed' });
  });

  it('fails with verify_failed when the kid is not in the JWKS', async () => {
    const idToken = jwt.sign(
      {
        iss: 'https://appleid.apple.com',
        aud: SERVICES_ID,
        sub: 'apple-sub-007',
        email: 'user@example.com',
        email_verified: true,
      },
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', header: { alg: 'RS256', kid: 'unknown-kid' } }
    );
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithApple('auth-code');

    expect(result).toMatchObject({ ok: false, reason: 'verify_failed' });
  });

  it('fails with token_exchange_failed and the provider error body', async () => {
    const axiosError = Object.assign(
      new Error('Request failed with status code 400'),
      {
        isAxiosError: true,
        response: {
          status: 400,
          data: { error: 'invalid_grant' },
        },
      }
    );
    mockedAxios.post = jest.fn().mockRejectedValue(axiosError);

    const service = createService();
    const result = await service.loginWithApple('auth-code');

    expect(result).toMatchObject({
      ok: false,
      reason: 'token_exchange_failed',
    });
    if (result.ok === false) {
      expect(result.message).toContain('400');
      expect(result.message).toContain('invalid_grant');
    }
  });

  it('fails with missing_sub when the sub claim is missing', async () => {
    const idToken = signIdToken({
      iss: 'https://appleid.apple.com',
      aud: SERVICES_ID,
      email: 'user@example.com',
      email_verified: true,
    });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithApple('auth-code');

    expect(result).toMatchObject({ ok: false, reason: 'missing_sub' });
  });
});

describe('loginWithApple algorithm pin', () => {
  const SERVICES_ID = 'com.example.2anki';
  const KID = 'apple-rsa-key-001';
  let rsaPrivateKey: crypto.KeyObject;
  let rsaPublicJwk: Record<string, unknown>;
  let ecPrivateKey: crypto.KeyObject;
  let ecPublicJwk: Record<string, unknown>;

  beforeAll(() => {
    const rsaPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    rsaPrivateKey = rsaPair.privateKey;
    const rawJwk = rsaPair.publicKey.export({ format: 'jwk' });
    rsaPublicJwk = { ...rawJwk, kid: KID, alg: 'RS256', use: 'sig' };

    const ecPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    ecPrivateKey = ecPair.privateKey;
    const rawEcJwk = ecPair.publicKey.export({ format: 'jwk' });
    ecPublicJwk = { ...rawEcJwk, kid: KID, alg: 'ES256', use: 'sig' };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    __resetAppleJwksCacheForTests();
    process.env.APPLE_SERVICES_ID = SERVICES_ID;
    process.env.APPLE_REDIRECT_URI = 'https://2anki.net/api/users/auth/apple';
    process.env.APPLE_TEAM_ID = 'TEAMID1234';
    process.env.APPLE_KEY_ID = 'KEYID56789';
    const { privateKey: sk } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    process.env.APPLE_PRIVATE_KEY = sk.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
  });

  it('accepts an RS256-signed id_token (Apple production algorithm)', async () => {
    const idToken = jwt.sign(
      {
        iss: 'https://appleid.apple.com',
        aud: SERVICES_ID,
        sub: 'apple-rsa-sub-001',
        email: 'rsa-user@example.com',
        email_verified: true,
      },
      rsaPrivateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', header: { alg: 'RS256', kid: KID } }
    );
    mockedAxios.get = jest
      .fn()
      .mockResolvedValue({ data: { keys: [rsaPublicJwk] } });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithApple('auth-code');

    expect(result).toEqual({
      ok: true,
      subject: 'apple-rsa-sub-001',
      email: 'rsa-user@example.com',
      emailVerified: true,
      refreshToken: undefined,
    });
  });

  it('rejects an ES256-signed id_token (algorithm substitution defense)', async () => {
    const idToken = jwt.sign(
      {
        iss: 'https://appleid.apple.com',
        aud: SERVICES_ID,
        sub: 'apple-ec-sub-001',
        email: 'ec-user@example.com',
        email_verified: true,
      },
      ecPrivateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'ES256', header: { alg: 'ES256', kid: KID } }
    );
    mockedAxios.get = jest
      .fn()
      .mockResolvedValue({ data: { keys: [ecPublicJwk] } });
    mockedAxios.post = jest
      .fn()
      .mockResolvedValue({ data: { id_token: idToken } });

    const service = createService();
    const result = await service.loginWithApple('auth-code');

    expect(result).toMatchObject({ ok: false, reason: 'verify_failed' });
  });
});

describe('revokeAppleToken', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.APPLE_CLIENT_ID = 'com.example.2anki';
    process.env.APPLE_TEAM_ID = 'TEAMID1234';
    process.env.APPLE_KEY_ID = 'KEYID56789';
    const { privateKey: sk } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    process.env.APPLE_PRIVATE_KEY_B64 = Buffer.from(
      sk.export({ type: 'pkcs8', format: 'pem' }) as string
    ).toString('base64');
  });

  it('posts the refresh token to the Apple revoke endpoint', async () => {
    mockedAxios.post = jest.fn().mockResolvedValue({ status: 200, data: {} });

    const service = createService();
    const result = await service.revokeAppleToken('apple-refresh-xyz');

    expect(result).toBe(true);
    const call = (mockedAxios.post as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('apple_login');
    expect(call[1]).toBe('https://appleid.apple.com/auth/revoke');
    expect(call[2]).toContain('token=apple-refresh-xyz');
    expect(call[2]).toContain('token_type_hint=refresh_token');
  });

  it('treats a 400 from Apple (already revoked) as success', async () => {
    const axiosError = Object.assign(new Error('bad request'), {
      isAxiosError: true,
      response: { status: 400 },
    });
    mockedAxios.post = jest.fn().mockRejectedValue(axiosError);

    const service = createService();
    const result = await service.revokeAppleToken('apple-refresh-xyz');

    expect(result).toBe(true);
  });

  it('returns false on an unexpected error', async () => {
    mockedAxios.post = jest.fn().mockRejectedValue(new Error('network down'));

    const service = createService();
    const result = await service.revokeAppleToken('apple-refresh-xyz');

    expect(result).toBe(false);
  });

  it('returns false when APPLE_CLIENT_ID is missing', async () => {
    delete process.env.APPLE_CLIENT_ID;
    mockedAxios.post = jest.fn();

    const service = createService();
    const result = await service.revokeAppleToken('apple-refresh-xyz');

    expect(result).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

describe('verifyAppleIdentityToken', () => {
  const NATIVE_CLIENT_ID = 'no.laersmart.2anki';
  const KID = 'apple-native-key-001';
  let privateKey: crypto.KeyObject;
  let publicJwk: Record<string, unknown>;

  const signIdToken = (payload: Record<string, unknown>): string =>
    jwt.sign(payload, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      algorithm: 'RS256',
      header: { alg: 'RS256', kid: KID },
    });

  beforeAll(() => {
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    publicJwk = pair.publicKey.export({ format: 'jwk' }) as Record<
      string,
      unknown
    >;
    publicJwk['kid'] = KID;
    publicJwk['alg'] = 'RS256';
    publicJwk['use'] = 'sig';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    __resetAppleJwksCacheForTests();
    process.env.APPLE_NATIVE_CLIENT_ID = NATIVE_CLIENT_ID;
    mockedAxios.get = jest
      .fn()
      .mockResolvedValue({ data: { keys: [publicJwk] } });
  });

  it('returns subject and email for a valid identity token signed for the native audience', async () => {
    const idToken = signIdToken({
      iss: 'https://appleid.apple.com',
      aud: NATIVE_CLIENT_ID,
      sub: 'native-sub-001',
      email: 'native@example.com',
      email_verified: true,
    });

    const service = createService();
    const result = await service.verifyAppleIdentityToken(idToken);

    expect(result).toEqual({
      subject: 'native-sub-001',
      email: 'native@example.com',
    });
  });

  it('returns subject without email when email claim is absent', async () => {
    const idToken = signIdToken({
      iss: 'https://appleid.apple.com',
      aud: NATIVE_CLIENT_ID,
      sub: 'native-sub-002',
      email_verified: true,
    });

    const service = createService();
    const result = await service.verifyAppleIdentityToken(idToken);

    expect(result).toEqual({ subject: 'native-sub-002', email: undefined });
  });

  it('returns undefined when the audience is the web Service ID, not the native App ID', async () => {
    const idToken = signIdToken({
      iss: 'https://appleid.apple.com',
      aud: 'com.example.2anki-web-service-id',
      sub: 'native-sub-003',
      email: 'native@example.com',
      email_verified: true,
    });

    const service = createService();
    const result = await service.verifyAppleIdentityToken(idToken);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the issuer is not Apple', async () => {
    const idToken = signIdToken({
      iss: 'https://evil.example.com',
      aud: NATIVE_CLIENT_ID,
      sub: 'native-sub-004',
      email: 'native@example.com',
      email_verified: true,
    });

    const service = createService();
    const result = await service.verifyAppleIdentityToken(idToken);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the signature is invalid', async () => {
    const wrongPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const idToken = jwt.sign(
      {
        iss: 'https://appleid.apple.com',
        aud: NATIVE_CLIENT_ID,
        sub: 'native-sub-005',
        email: 'native@example.com',
        email_verified: true,
      },
      wrongPair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', header: { alg: 'RS256', kid: KID } }
    );

    const service = createService();
    const result = await service.verifyAppleIdentityToken(idToken);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the sub claim is missing', async () => {
    const idToken = signIdToken({
      iss: 'https://appleid.apple.com',
      aud: NATIVE_CLIENT_ID,
      email: 'native@example.com',
      email_verified: true,
    });

    const service = createService();
    const result = await service.verifyAppleIdentityToken(idToken);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the kid is not in the JWKS', async () => {
    const idToken = jwt.sign(
      {
        iss: 'https://appleid.apple.com',
        aud: NATIVE_CLIENT_ID,
        sub: 'native-sub-007',
        email: 'native@example.com',
        email_verified: true,
      },
      privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'RS256', header: { alg: 'RS256', kid: 'unknown-kid' } }
    );

    const service = createService();
    const result = await service.verifyAppleIdentityToken(idToken);

    expect(result).toBeUndefined();
  });

  it('returns undefined when APPLE_NATIVE_CLIENT_ID is not set', async () => {
    delete process.env.APPLE_NATIVE_CLIENT_ID;
    const idToken = signIdToken({
      iss: 'https://appleid.apple.com',
      aud: NATIVE_CLIENT_ID,
      sub: 'native-sub-008',
      email: 'native@example.com',
      email_verified: true,
    });

    const service = createService();
    const result = await service.verifyAppleIdentityToken(idToken);

    expect(result).toBeUndefined();
  });

  it('rejects ES256-signed tokens (algorithm substitution defense)', async () => {
    const ecPair = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const ecPublicJwk = {
      ...(ecPair.publicKey.export({ format: 'jwk' }) as Record<
        string,
        unknown
      >),
      kid: KID,
      alg: 'ES256',
      use: 'sig',
    };
    mockedAxios.get = jest
      .fn()
      .mockResolvedValue({ data: { keys: [ecPublicJwk] } });
    const idToken = jwt.sign(
      {
        iss: 'https://appleid.apple.com',
        aud: NATIVE_CLIENT_ID,
        sub: 'native-sub-009',
        email: 'native@example.com',
        email_verified: true,
      },
      ecPair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      { algorithm: 'ES256', header: { alg: 'ES256', kid: KID } }
    );

    const service = createService();
    const result = await service.verifyAppleIdentityToken(idToken);

    expect(result).toBeUndefined();
  });
});

describe('isNewPasswordValid', () => {
  it('returns false (valid) for a UUID-length reset token and a strong password', () => {
    const service = createService();
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(service.isNewPasswordValid(uuid, 'password123')).toBe(false);
  });

  it('returns true (invalid) for an empty reset token', () => {
    const service = createService();
    expect(service.isNewPasswordValid('', 'password123')).toBe(true);
  });

  it('returns true (invalid) for a password shorter than 8 characters', () => {
    const service = createService();
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(service.isNewPasswordValid(uuid, 'short')).toBe(true);
  });

  it('returns true (invalid) for a non-string reset token', () => {
    const service = createService();
    expect(service.isNewPasswordValid(null, 'password123')).toBe(true);
  });
});

describe('revokeSessionsByResetToken', () => {
  let database: Knex;
  let service: AuthenticationService;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await database.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.text('email').notNullable();
      t.text('reset_token').nullable();
    });
    await database.schema.createTable('access_tokens', (t) => {
      t.integer('owner').notNullable().index();
      t.text('token').notNullable().index();
      t.timestamp('created_at').defaultTo(database.fn.now());
    });
    service = new AuthenticationService(
      new TokenRepository(database),
      new UsersRepository(database)
    );
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('deletes every session of the user matching the reset token', async () => {
    const [{ id }] = await database('users')
      .insert({ email: 'a@example.com', reset_token: 'reset-1' })
      .returning('id');
    await database('access_tokens').insert([
      { token: 'web', owner: id },
      { token: 'app', owner: id },
    ]);

    const deleted = await service.revokeSessionsByResetToken('reset-1');

    expect(deleted).toBe(2);
    expect(await database('access_tokens').select('token')).toEqual([]);
  });

  it('leaves other users sessions untouched', async () => {
    const [{ id: resetUserId }] = await database('users')
      .insert({ email: 'a@example.com', reset_token: 'reset-1' })
      .returning('id');
    const [{ id: otherUserId }] = await database('users')
      .insert({ email: 'b@example.com' })
      .returning('id');
    await database('access_tokens').insert([
      { token: 'reset-user-session', owner: resetUserId },
      { token: 'other-user-session', owner: otherUserId },
    ]);

    await service.revokeSessionsByResetToken('reset-1');

    const tokens = (await database('access_tokens').select('token')).map(
      (row) => row.token
    );
    expect(tokens).toEqual(['other-user-session']);
  });

  it('deletes nothing when the reset token matches no user', async () => {
    const [{ id }] = await database('users')
      .insert({ email: 'a@example.com', reset_token: 'reset-1' })
      .returning('id');
    await database('access_tokens').insert({ token: 'web', owner: id });

    const deleted = await service.revokeSessionsByResetToken('wrong-token');

    expect(deleted).toBe(0);
    const tokens = (await database('access_tokens').select('token')).map(
      (row) => row.token
    );
    expect(tokens).toEqual(['web']);
  });
});

describe('logOutEverywhere', () => {
  let database: Knex;
  let service: AuthenticationService;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await database.schema.createTable('access_tokens', (t) => {
      t.integer('owner').notNullable().index();
      t.text('token').notNullable().index();
      t.timestamp('created_at').defaultTo(database.fn.now());
    });
    service = new AuthenticationService(
      new TokenRepository(database),
      new UsersRepository(database)
    );
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('deletes every session owned by the given owner', async () => {
    await database('access_tokens').insert([
      { token: 'web', owner: 7 },
      { token: 'app', owner: 7 },
      { token: 'other', owner: 8 },
    ]);

    const deleted = await service.logOutEverywhere(7);

    expect(deleted).toBe(2);
    const tokens = (await database('access_tokens').select('token')).map(
      (row) => row.token
    );
    expect(tokens).toEqual(['other']);
  });

  it('accepts a numeric owner and coerces it for the lookup', async () => {
    await database('access_tokens').insert({ token: 'web', owner: 7 });

    const deleted = await service.logOutEverywhere(7);

    expect(deleted).toBe(1);
  });
});

describe('subscription lookups by linked_email', () => {
  let database: Knex;
  let service: AuthenticationService;

  beforeEach(async () => {
    database = knex({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await database.schema.createTable('subscriptions', (t) => {
      t.increments('id').primary();
      t.text('email').nullable();
      t.text('linked_email').nullable();
      t.boolean('active').notNullable().defaultTo(false);
    });
    service = new AuthenticationService(
      new TokenRepository(database),
      new UsersRepository(database)
    );
  });

  afterEach(async () => {
    await database.destroy();
  });

  it('getIsSubscriber returns true when an active row shares a linked_email with an older inactive one', async () => {
    await database('subscriptions').insert([
      {
        email: 'gifter-old@example.com',
        linked_email: 'recipient@example.com',
        active: false,
      },
      {
        email: 'gifter-new@example.com',
        linked_email: 'recipient@example.com',
        active: true,
      },
    ]);

    const result = await service.getIsSubscriber(
      database,
      'recipient@example.com'
    );

    expect(result).toBe(true);
  });

  it('getIsSubscriber returns true when an active row shares the payer email with an older cancelled one', async () => {
    await database('subscriptions').insert([
      { email: 'payer@example.com', linked_email: null, active: false },
      { email: 'payer@example.com', linked_email: null, active: true },
    ]);

    const result = await service.getIsSubscriber(database, 'payer@example.com');

    expect(result).toBe(true);
  });

  it('getIsSubscriber returns false when only cancelled rows exist for the payer email', async () => {
    await database('subscriptions').insert([
      { email: 'payer@example.com', linked_email: null, active: false },
    ]);

    const result = await service.getIsSubscriber(database, 'payer@example.com');

    expect(result).toBe(false);
  });

  it('getSubscriptionInfo resolves the active linked row over an older inactive one', async () => {
    await database('subscriptions').insert([
      {
        email: 'gifter-old@example.com',
        linked_email: 'recipient@example.com',
        active: false,
      },
      {
        email: 'gifter-new@example.com',
        linked_email: 'recipient@example.com',
        active: true,
      },
    ]);

    const result = await service.getSubscriptionInfo(
      database,
      'recipient@example.com'
    );

    expect(result).toEqual({
      active: true,
      email: 'gifter-new@example.com',
      linked_email: 'recipient@example.com',
    });
  });
});
