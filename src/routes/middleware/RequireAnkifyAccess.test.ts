import { vi, type Mock } from 'vitest';
import express from 'express';

import { makeRequireAnkifyAccess } from './RequireAnkifyAccess';
import AuthenticationService from '../../services/AuthenticationService';
import SubscriptionService from '../../services/SubscriptionService';

vi.mock('../../lib/integrations/stripe', () => ({
  getStripe: vi.fn(),
  getCustomerId: vi.fn(),
  updateStoreSubscription: vi.fn(),
}));

vi.mock('../../services/SubscriptionService');

const AUTO_SYNC_PRODUCT_ID = 'prod_test_auto_sync';

const makeRequest = (token: string | undefined): express.Request =>
  ({
    cookies: token == null ? {} : { token },
  }) as unknown as express.Request;

interface FakeResponse {
  statusCode: number;
  body: unknown;
  locals: Record<string, unknown>;
  status: Mock;
  json: Mock;
}

const makeResponse = (): FakeResponse => {
  const state: FakeResponse = {
    statusCode: 200,
    body: undefined,
    locals: {},
  } as FakeResponse;

  state.status = vi.fn((code: number) => {
    state.statusCode = code;
    return state;
  });

  state.json = vi.fn((body: unknown) => {
    state.body = body;
    return state;
  });

  return state;
};

const makeAuthService = (
  user: { id: number; email: string; patreon: boolean | null } | null
): AuthenticationService =>
  ({
    getUserFrom: vi.fn(async () =>
      user == null ? null : { ...user, owner: user.id }
    ),
  }) as unknown as AuthenticationService;

const mockGetUserActiveSubscriptions =
  SubscriptionService.getUserActiveSubscriptions as Mock;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.AUTO_SYNC_PRODUCT_ID = AUTO_SYNC_PRODUCT_ID;
});

afterEach(() => {
  delete process.env.AUTO_SYNC_PRODUCT_ID;
});

describe('RequireAnkifyAccess', () => {
  test('401s when no authenticated user', async () => {
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    const middleware = makeRequireAnkifyAccess(makeAuthService(null));
    const res = makeResponse();
    const next = vi.fn();

    await middleware(
      makeRequest(undefined),
      res as unknown as express.Response,
      next
    );

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('403s when authenticated user has no patreon access and no active Auto Sync sub', async () => {
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    const middleware = makeRequireAnkifyAccess(
      makeAuthService({
        id: 7,
        email: 'someone-else@example.com',
        patreon: false,
      })
    );
    const res = makeResponse();
    const next = vi.fn();

    await middleware(
      makeRequest('cookie-token'),
      res as unknown as express.Response,
      next
    );

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('403s when patreon is null and no active Auto Sync sub', async () => {
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    const middleware = makeRequireAnkifyAccess(
      makeAuthService({
        id: 7,
        email: 'someone-else@example.com',
        patreon: null,
      })
    );
    const res = makeResponse();
    const next = vi.fn();

    await middleware(
      makeRequest('cookie-token'),
      res as unknown as express.Response,
      next
    );

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next and sets owner local when user has patreon access', async () => {
    mockGetUserActiveSubscriptions.mockResolvedValue([]);
    const middleware = makeRequireAnkifyAccess(
      makeAuthService({
        id: 42,
        email: 'patron@example.com',
        patreon: true,
      })
    );
    const res = makeResponse();
    const next = vi.fn();

    await middleware(
      makeRequest('cookie-token'),
      res as unknown as express.Response,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.locals.owner).toBe(42);
  });

  test('calls next when user has active Auto Sync subscription', async () => {
    mockGetUserActiveSubscriptions.mockResolvedValue([
      { active: true, stripe_product_id: AUTO_SYNC_PRODUCT_ID },
    ]);
    const middleware = makeRequireAnkifyAccess(
      makeAuthService({
        id: 99,
        email: 'subscriber@example.com',
        patreon: false,
      })
    );
    const res = makeResponse();
    const next = vi.fn();

    await middleware(
      makeRequest('cookie-token'),
      res as unknown as express.Response,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.locals.owner).toBe(99);
  });

  test('403s when subscription is active but for a different product', async () => {
    mockGetUserActiveSubscriptions.mockResolvedValue([
      { active: true, stripe_product_id: 'prod_unlimited' },
    ]);
    const middleware = makeRequireAnkifyAccess(
      makeAuthService({
        id: 55,
        email: 'unlimited@example.com',
        patreon: false,
      })
    );
    const res = makeResponse();
    const next = vi.fn();

    await middleware(
      makeRequest('cookie-token'),
      res as unknown as express.Response,
      next
    );

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
