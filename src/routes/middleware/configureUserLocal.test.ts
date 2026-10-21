import { configureUserLocal } from './configureUserLocal';
import { InMemoryAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import { InMemoryUserPassRepository } from '../../data_layer/UserPassRepository';
import type { Request, Response } from 'express';

function makeRes(): Response {
  return { locals: {} } as Response;
}

function makeReq(
  headers: Record<string, string> = {},
  cookies: Record<string, string> = {}
): Request {
  return { headers, cookies } as unknown as Request;
}

const noOpAuthService = {
  getUserFrom: async () => null,
  getIsSubscriber: async () => false,
  getSubscriptionInfo: async () => null,
} as never;

const noDatabase = {} as never;

describe('configureUserLocal — anonymous pass token', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('sets subscriber=true when a valid unexpired anonymous pass token is in X-Pass-Token header', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await anonRepo.insert({
      stripeSessionId: 'cs_valid',
      kind: '24h',
      expiresAt,
      paymentIntentId: 'pi_1',
    });

    const req = makeReq({ 'x-pass-token': 'cs_valid' });
    const res = makeRes();

    await configureUserLocal(
      req,
      res,
      noOpAuthService,
      noDatabase,
      anonRepo,
      now
    );

    expect(res.locals.subscriber).toBe(true);
    expect(res.locals.passKind).toBe('24h');
    expect(res.locals.anonymousPassId).toBe(1);
  });

  it('does not set subscriber=true for an expired anonymous pass token', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    const expiresAt = new Date(now.getTime() - 1000);
    await anonRepo.insert({
      stripeSessionId: 'cs_expired',
      kind: '24h',
      expiresAt,
      paymentIntentId: 'pi_2',
    });

    const req = makeReq({ 'x-pass-token': 'cs_expired' });
    const res = makeRes();

    await configureUserLocal(
      req,
      res,
      noOpAuthService,
      noDatabase,
      anonRepo,
      now
    );

    expect(res.locals.subscriber).toBeUndefined();
    expect(res.locals.anonymousPassId).toBeUndefined();
  });

  it('does not set subscriber=true when no X-Pass-Token header is present', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();

    const req = makeReq();
    const res = makeRes();

    await configureUserLocal(
      req,
      res,
      noOpAuthService,
      noDatabase,
      anonRepo,
      now
    );

    expect(res.locals.subscriber).toBeUndefined();
  });
});

describe('configureUserLocal — planSource', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const futureExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  function makeAuthService(opts: { patreon: boolean; isSubscriber: boolean }) {
    return {
      getUserFrom: async () => ({
        owner: 1,
        email: 'learner@example.com',
        patreon: opts.patreon,
        chat_consent_at: null,
      }),
      getIsSubscriber: async () => opts.isSubscriber,
      getSubscriptionInfo: async () => null,
    } as never;
  }

  it("sets planSource 'apple' for an active apple:-prefixed unlimited pass with no Stripe sub", async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    const userPassRepo = new InMemoryUserPassRepository();
    userPassRepo.seed({
      user_id: 1,
      kind: 'unlimited',
      expires_at: futureExpiry,
      stripe_payment_intent_id: 'apple:txn_123',
    });

    const req = makeReq({}, { token: 't' });
    const res = makeRes();

    await configureUserLocal(
      req,
      res,
      makeAuthService({ patreon: false, isSubscriber: false }),
      noDatabase,
      anonRepo,
      now,
      undefined,
      userPassRepo
    );

    expect(res.locals.subscriber).toBe(true);
    expect(res.locals.planSource).toBe('apple');
  });

  it("sets planSource 'stripe' when an active Stripe sub exists even if a pass is present", async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    const userPassRepo = new InMemoryUserPassRepository();
    userPassRepo.seed({
      user_id: 1,
      kind: 'unlimited',
      expires_at: futureExpiry,
      stripe_payment_intent_id: 'apple:txn_123',
    });

    const req = makeReq({}, { token: 't' });
    const res = makeRes();

    await configureUserLocal(
      req,
      res,
      makeAuthService({ patreon: true, isSubscriber: true }),
      noDatabase,
      anonRepo,
      now,
      undefined,
      userPassRepo
    );

    expect(res.locals.subscriber).toBe(true);
    expect(res.locals.planSource).toBe('stripe');
  });

  it("sets planSource 'lifetime' for a patreon-only user with no sub and no pass", async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    const userPassRepo = new InMemoryUserPassRepository();

    const req = makeReq({}, { token: 't' });
    const res = makeRes();

    await configureUserLocal(
      req,
      res,
      makeAuthService({ patreon: true, isSubscriber: false }),
      noDatabase,
      anonRepo,
      now,
      undefined,
      userPassRepo
    );

    expect(res.locals.planSource).toBe('lifetime');
  });

  it('sets planSource null for a non-apple 24h pass with no sub and no patreon', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    const userPassRepo = new InMemoryUserPassRepository();
    userPassRepo.seed({
      user_id: 1,
      kind: '24h',
      expires_at: futureExpiry,
      stripe_payment_intent_id: 'pi_stripe_daypass',
    });

    const req = makeReq({}, { token: 't' });
    const res = makeRes();

    await configureUserLocal(
      req,
      res,
      makeAuthService({ patreon: false, isSubscriber: false }),
      noDatabase,
      anonRepo,
      now,
      undefined,
      userPassRepo
    );

    expect(res.locals.subscriber).toBe(true);
    expect(res.locals.planSource).toBeNull();
  });
});
