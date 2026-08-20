import type { Knex } from 'knex';
import { ConfirmPassClaimUseCase } from './ConfirmPassClaimUseCase';
import { InMemoryAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import type { IPassClaimTokensRepository } from '../../data_layer/PassClaimTokensRepository';
import type { ISubscriptionClaimAuditRepository } from '../../data_layer/SubscriptionClaimAuditRepository';
import type { IUserPassRepository } from '../../data_layer/UserPassRepository';
import hmacToken from '../../lib/misc/hmacToken';

process.env.THE_HASHING_SECRET = 'test-secret-for-jest';

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const RAW_TOKEN = 'raw-token-uuid';

function makeDb(): Knex {
  const fakeTrx = { fn: { now: () => new Date() } };
  return {
    transaction: async (cb: (trx: unknown) => Promise<void>) => cb(fakeTrx),
  } as unknown as Knex;
}

function makeTokensRepo(
  overrides: Partial<IPassClaimTokensRepository> = {}
): IPassClaimTokensRepository {
  return {
    insert: jest.fn(),
    findByTokenHash: jest.fn().mockResolvedValue({
      id: 10,
      user_id: 42,
      anonymous_pass_id: 1,
      token_hash: hmacToken(RAW_TOKEN),
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      consumed_at: null,
      created_at: new Date(),
    }),
    markConsumed: jest.fn().mockResolvedValue(undefined),
    countRecentByUser: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makeAuditRepo(): ISubscriptionClaimAuditRepository {
  return {
    insert: jest.fn().mockResolvedValue({}),
    countRecentByIp: jest.fn().mockResolvedValue(0),
  } as unknown as ISubscriptionClaimAuditRepository;
}

function makeUserPassRepo(
  overrides: Partial<IUserPassRepository> = {}
): IUserPassRepository {
  return {
    findActive: jest.fn(),
    countPaidPassesSince: jest.fn(),
    upsertWithExtension: jest.fn(),
    upsertWithAbsoluteExpiry: jest.fn().mockResolvedValue({
      id: 1,
      user_id: 42,
      kind: '7d',
      expires_at: FUTURE,
      stripe_payment_intent_id: 'pi_1',
    }),
    ...overrides,
  } as IUserPassRepository;
}

async function seedPass(anonRepo: InMemoryAnonymousPassRepository) {
  return anonRepo.insert({
    stripeSessionId: 'cs_1',
    kind: '7d',
    expiresAt: FUTURE,
    paymentIntentId: 'pi_1',
    buyerEmailHash: 'hash',
  });
}

describe('ConfirmPassClaimUseCase', () => {
  it('starts the pass window at claim when it was never used, and marks the anon row claimed', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const now = Date.now();
    const anonRepo = new InMemoryAnonymousPassRepository();
    await anonRepo.insert({
      stripeSessionId: 'cs_1',
      kind: '7d',
      expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
      paymentIntentId: 'pi_1',
      buyerEmailHash: 'hash',
    });
    const tokensRepo = makeTokensRepo();
    const userPassRepo = makeUserPassRepo();
    const useCase = new ConfirmPassClaimUseCase(
      makeDb(),
      tokensRepo,
      anonRepo,
      userPassRepo,
      makeAuditRepo()
    );

    const outcome = await useCase.execute(42, RAW_TOKEN, 'ip', 'eh');

    const expected = new Date(now + 7 * 24 * 60 * 60 * 1000);
    expect(outcome).toEqual({
      success: true,
      passKind: '7d',
      expiresAt: expected,
    });
    expect(userPassRepo.upsertWithAbsoluteExpiry).toHaveBeenCalledWith(
      42,
      '7d',
      expected,
      'pi_1'
    );
    const row = await anonRepo.findById(1);
    expect(row?.claimed_by_user_id).toBe(42);
    expect(row?.activated_at).toEqual(new Date(now));
    expect(row?.expires_at).toEqual(expected);
    expect(tokensRepo.markConsumed).toHaveBeenCalledWith(10, expect.anything());
    jest.useRealTimers();
  });

  it('carries the remaining window when the pass was already used anonymously', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    const now = Date.now();
    const anonRepo = new InMemoryAnonymousPassRepository();
    const pass = await anonRepo.insert({
      stripeSessionId: 'cs_2',
      kind: '7d',
      expiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
      paymentIntentId: 'pi_1',
      buyerEmailHash: 'hash',
    });
    const remaining = new Date(now + 6 * 24 * 60 * 60 * 1000);
    await anonRepo.activate(
      pass.id,
      new Date(now - 24 * 60 * 60 * 1000),
      remaining
    );
    const userPassRepo = makeUserPassRepo();
    const useCase = new ConfirmPassClaimUseCase(
      makeDb(),
      makeTokensRepo(),
      anonRepo,
      userPassRepo,
      makeAuditRepo()
    );

    const outcome = await useCase.execute(42, RAW_TOKEN, 'ip', 'eh');

    expect(outcome).toEqual({
      success: true,
      passKind: '7d',
      expiresAt: remaining,
    });
    expect(userPassRepo.upsertWithAbsoluteExpiry).toHaveBeenCalledWith(
      42,
      '7d',
      remaining,
      'pi_1'
    );
    jest.useRealTimers();
  });

  it('rejects an unknown or expired token', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    await seedPass(anonRepo);
    const useCase = new ConfirmPassClaimUseCase(
      makeDb(),
      makeTokensRepo({ findByTokenHash: jest.fn().mockResolvedValue(null) }),
      anonRepo,
      makeUserPassRepo(),
      makeAuditRepo()
    );

    const outcome = await useCase.execute(42, RAW_TOKEN, 'ip', 'eh');

    expect(outcome).toEqual({ success: false, reason: 'invalid_token' });
  });

  it('rejects a consumed token as already claimed', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    await seedPass(anonRepo);
    const tokensRepo = makeTokensRepo();
    (tokensRepo.findByTokenHash as jest.Mock).mockResolvedValue({
      id: 10,
      user_id: 42,
      anonymous_pass_id: 1,
      token_hash: hmacToken(RAW_TOKEN),
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
      consumed_at: new Date(),
      created_at: new Date(),
    });
    const useCase = new ConfirmPassClaimUseCase(
      makeDb(),
      tokensRepo,
      anonRepo,
      makeUserPassRepo(),
      makeAuditRepo()
    );

    const outcome = await useCase.execute(42, RAW_TOKEN, 'ip', 'eh');

    expect(outcome).toEqual({ success: false, reason: 'already_claimed' });
  });

  it('rejects when the pass was already claimed by someone else', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    const pass = await seedPass(anonRepo);
    await anonRepo.claim(pass.id, 7);
    const useCase = new ConfirmPassClaimUseCase(
      makeDb(),
      makeTokensRepo(),
      anonRepo,
      makeUserPassRepo(),
      makeAuditRepo()
    );

    const outcome = await useCase.execute(42, RAW_TOKEN, 'ip', 'eh');

    expect(outcome).toEqual({ success: false, reason: 'already_claimed' });
  });

  it('rejects a pass that expired before confirmation', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    await anonRepo.insert({
      stripeSessionId: 'cs_old',
      kind: '7d',
      expiresAt: new Date('2020-01-01T00:00:00Z'),
      paymentIntentId: 'pi_old',
      buyerEmailHash: 'hash',
    });
    const useCase = new ConfirmPassClaimUseCase(
      makeDb(),
      makeTokensRepo(),
      anonRepo,
      makeUserPassRepo(),
      makeAuditRepo()
    );

    const outcome = await useCase.execute(42, RAW_TOKEN, 'ip', 'eh');

    expect(outcome).toEqual({ success: false, reason: 'pass_expired' });
  });

  it('unclaims the anon row when the user-pass insert fails', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    await seedPass(anonRepo);
    const userPassRepo = makeUserPassRepo({
      upsertWithAbsoluteExpiry: jest
        .fn()
        .mockRejectedValue(new Error('db down')),
    });
    const useCase = new ConfirmPassClaimUseCase(
      makeDb(),
      makeTokensRepo(),
      anonRepo,
      userPassRepo,
      makeAuditRepo()
    );

    await expect(useCase.execute(42, RAW_TOKEN, 'ip', 'eh')).rejects.toThrow(
      'db down'
    );
    const row = await anonRepo.findById(1);
    expect(row?.claimed_by_user_id).toBeNull();
  });
});
