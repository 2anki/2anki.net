import { vi } from 'vitest';
vi.mock('../../services/SubscriptionService', () => ({
  __esModule: true,
  default: {
    getUserActiveSubscriptions: vi.fn().mockResolvedValue([]),
  },
}));

import { ValidateAnkifySessionTokenUseCase } from './ValidateAnkifySessionTokenUseCase';
import { RacService } from '../../services/ankify/RacService';
import AuthenticationService from '../../services/AuthenticationService';

const makeRac = (overrides: Partial<RacService> = {}): RacService =>
  ({
    resolveTokenForProxy: vi.fn(async () => null),
    touchTokenLastUsed: vi.fn(async () => undefined),
    ...overrides,
  }) as unknown as RacService;

const makeAuth = (overrides: Partial<AuthenticationService> = {}) =>
  ({
    getUserFrom: vi.fn(async () => null),
    ...overrides,
  }) as unknown as AuthenticationService;

describe('ValidateAnkifySessionTokenUseCase', () => {
  test('rejects empty session token', async () => {
    const useCase = new ValidateAnkifySessionTokenUseCase(
      makeRac(),
      makeAuth()
    );
    const result = await useCase.execute({
      sessionToken: '',
      cookieToken: 'whatever',
    });
    expect(result).toEqual({
      ok: false,
      status: 401,
      reason: 'missing_session_token',
    });
  });

  test('rejects unknown / revoked / expired session token', async () => {
    const rac = makeRac({
      resolveTokenForProxy: vi.fn(async () => null),
    });
    const useCase = new ValidateAnkifySessionTokenUseCase(rac, makeAuth());
    const result = await useCase.execute({
      sessionToken: 'abc',
      cookieToken: 'whatever',
    });
    expect(result).toEqual({
      ok: false,
      status: 401,
      reason: 'invalid_session_token',
    });
  });

  test('rejects when cookie is missing', async () => {
    const rac = makeRac({
      resolveTokenForProxy: vi.fn(async () => ({
        ankify_client_id: 1,
        owner: 42,
        novnc_port: 22000,
        token_id: 7,
      })),
    });
    const useCase = new ValidateAnkifySessionTokenUseCase(rac, makeAuth());
    const result = await useCase.execute({
      sessionToken: 'good-token',
      cookieToken: undefined,
    });
    expect(result).toEqual({
      ok: false,
      status: 401,
      reason: 'missing_cookie',
    });
  });

  test('rejects when the cookie does not resolve to a user', async () => {
    const rac = makeRac({
      resolveTokenForProxy: vi.fn(async () => ({
        ankify_client_id: 1,
        owner: 42,
        novnc_port: 22000,
        token_id: 7,
      })),
    });
    const auth = makeAuth({
      getUserFrom: vi.fn(async () => null),
    });
    const useCase = new ValidateAnkifySessionTokenUseCase(rac, auth);
    const result = await useCase.execute({
      sessionToken: 'good-token',
      cookieToken: 'bad-cookie',
    });
    expect(result).toEqual({
      ok: false,
      status: 401,
      reason: 'invalid_cookie',
    });
  });

  test('rejects when cookie owner does not match token owner (cookie binding)', async () => {
    const rac = makeRac({
      resolveTokenForProxy: vi.fn(async () => ({
        ankify_client_id: 1,
        owner: 42,
        novnc_port: 22000,
        token_id: 7,
      })),
    });
    const auth = makeAuth({
      getUserFrom: vi.fn(
        async () =>
          ({
            id: 999,
            owner: 999,
            email: 'patron@example.com',
            patreon: true,
          }) as never
      ),
    });
    const useCase = new ValidateAnkifySessionTokenUseCase(rac, auth);
    const result = await useCase.execute({
      sessionToken: 'good-token',
      cookieToken: 'wrong-user-cookie',
    });
    expect(result).toEqual({
      ok: false,
      status: 401,
      reason: 'cookie_owner_mismatch',
    });
  });

  test('rejects when user does not have patreon access (403)', async () => {
    const rac = makeRac({
      resolveTokenForProxy: vi.fn(async () => ({
        ankify_client_id: 1,
        owner: 42,
        novnc_port: 22000,
        token_id: 7,
      })),
    });
    const auth = makeAuth({
      getUserFrom: vi.fn(
        async () =>
          ({
            id: 42,
            owner: 42,
            email: 'someone-else@example.com',
            patreon: false,
          }) as never
      ),
    });
    const useCase = new ValidateAnkifySessionTokenUseCase(rac, auth);
    const result = await useCase.execute({
      sessionToken: 'good-token',
      cookieToken: 'cookie',
    });
    expect(result).toEqual({
      ok: false,
      status: 403,
      reason: 'not_allowlisted',
    });
  });

  test('returns the novnc port and touches last_used for a fully-valid request', async () => {
    const touchTokenLastUsed = vi.fn(async () => undefined);
    const rac = makeRac({
      resolveTokenForProxy: vi.fn(async () => ({
        ankify_client_id: 1,
        owner: 42,
        novnc_port: 22000,
        token_id: 7,
      })),
      touchTokenLastUsed,
    });
    const auth = makeAuth({
      getUserFrom: vi.fn(
        async () =>
          ({
            id: 42,
            owner: 42,
            email: 'patron@example.com',
            patreon: true,
          }) as never
      ),
    });
    const useCase = new ValidateAnkifySessionTokenUseCase(rac, auth);

    const result = await useCase.execute({
      sessionToken: 'good-token',
      cookieToken: 'good-cookie',
    });

    expect(result).toEqual({ ok: true, novnc_port: 22000 });
    expect(touchTokenLastUsed).toHaveBeenCalledWith(7);
  });
});
