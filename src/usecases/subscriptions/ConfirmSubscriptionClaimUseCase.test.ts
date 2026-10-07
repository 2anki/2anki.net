import { vi, type Mocked } from 'vitest';
import { ConfirmSubscriptionClaimUseCase } from './ConfirmSubscriptionClaimUseCase';
import type { ISubscriptionClaimTokensRepository } from '../../data_layer/SubscriptionClaimTokensRepository';
import type { ISubscriptionClaimAuditRepository } from '../../data_layer/SubscriptionClaimAuditRepository';
import type { SubscriptionService } from '../../services/SubscriptionService';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';
import type SubscriptionClaimTokens from '../../data_layer/public/SubscriptionClaimTokens';
import type { Knex } from 'knex';
import type UsersRepository from '../../data_layer/UsersRepository';

process.env.THE_HASHING_SECRET = 'test-secret-for-jest';

const makeFreshToken = (
  overrides: Partial<SubscriptionClaimTokens> = {}
): SubscriptionClaimTokens => ({
  id: 1 as SubscriptionClaimTokens['id'],
  user_id: 99 as SubscriptionClaimTokens['user_id'],
  stripe_customer_id: 'cus_test',
  token_hash: 'some-hash',
  expires_at: new Date(Date.now() + 10 * 60 * 1000),
  consumed_at: null,
  created_at: new Date(),
  ...overrides,
});

const makeTokensRepo = (
  overrides: Partial<ISubscriptionClaimTokensRepository> = {}
): ISubscriptionClaimTokensRepository => ({
  insert: vi.fn().mockResolvedValue(makeFreshToken()),
  findByTokenHash: vi.fn().mockResolvedValue(makeFreshToken()),
  markConsumed: vi.fn().mockResolvedValue(undefined),
  countRecentByUser: vi.fn().mockResolvedValue(0),
  ...overrides,
});

const makeAuditRepo = (
  overrides: Partial<ISubscriptionClaimAuditRepository> = {}
): ISubscriptionClaimAuditRepository => ({
  insert: vi.fn().mockResolvedValue({
    id: 1,
    user_id: 99,
    email_hash: 'eh',
    ip_hash: 'ih',
    outcome: 'confirm_success',
    created_at: new Date(),
  }),
  countRecentByIp: vi.fn().mockResolvedValue(0),
  ...overrides,
});

const makeUsersRepo = (): Mocked<Pick<UsersRepository, 'getEmailById'>> => ({
  getEmailById: vi.fn().mockResolvedValue('user@example.com'),
});

const makeSubscriptionService = (subs: StripeTypes.Subscription[] = []) =>
  ({
    findActiveStripeSubscriptions: vi.fn().mockResolvedValue(subs),
  }) as unknown as typeof SubscriptionService;

const makeStripe = (): Mocked<StripeTypes> =>
  ({
    customers: {
      retrieve: vi.fn().mockResolvedValue({
        id: 'cus_test',
        email: 'payer@example.com',
        subscriptions: { data: [] },
      }),
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
  }) as unknown as Mocked<StripeTypes>;

const makeTransactionalDb = (shouldThrowConstraint = false): Knex => {
  const trxFn = vi
    .fn()
    .mockImplementation(
      async (fn: (trx: Knex.Transaction) => Promise<void>) => {
        if (shouldThrowConstraint) {
          const err = Object.assign(new Error('duplicate key'), {
            code: '23505',
          });
          throw err;
        }
        const fakeTrx = {
          fn: { now: () => new Date() },
          raw: vi.fn(),
        } as unknown as Knex.Transaction;

        const tableProxy = () => ({
          where: () => ({
            forUpdate: () => ({ first: vi.fn().mockResolvedValue({}) }),
            update: vi.fn().mockResolvedValue(1),
          }),
        });

        Object.assign(fakeTrx, tableProxy);
        (fakeTrx as unknown as CallableFunction) = tableProxy;

        await fn(fakeTrx);
      }
    );
  return { transaction: trxFn } as unknown as Knex;
};

describe('ConfirmSubscriptionClaimUseCase', () => {
  it('returns invalid_token when no token found', async () => {
    const tokensRepo = makeTokensRepo({
      findByTokenHash: vi.fn().mockResolvedValue(null),
    });
    const useCase = new ConfirmSubscriptionClaimUseCase(
      makeTransactionalDb(),
      tokensRepo,
      makeAuditRepo(),
      makeUsersRepo() as unknown as UsersRepository,
      makeSubscriptionService(),
      makeStripe()
    );
    const result = await useCase.execute(
      99,
      'bad-token',
      'ip-hash',
      'email-hash'
    );
    expect(result).toEqual({ success: false, reason: 'invalid_token' });
  });

  it('expires tokens after 15 minutes', async () => {
    const expiredToken = makeFreshToken({
      expires_at: new Date(Date.now() - 1000),
    });
    const tokensRepo = makeTokensRepo({
      findByTokenHash: vi.fn().mockResolvedValue(expiredToken),
    });
    const useCase = new ConfirmSubscriptionClaimUseCase(
      makeTransactionalDb(),
      tokensRepo,
      makeAuditRepo(),
      makeUsersRepo() as unknown as UsersRepository,
      makeSubscriptionService(),
      makeStripe()
    );
    const result = await useCase.execute(
      99,
      'expired-token',
      'ip-hash',
      'email-hash'
    );
    expect(result).toEqual({ success: false, reason: 'invalid_token' });
  });

  it('rejects with already_consumed on token replay', async () => {
    const consumedToken = makeFreshToken({
      consumed_at: new Date(Date.now() - 5000),
    });
    const tokensRepo = makeTokensRepo({
      findByTokenHash: vi.fn().mockResolvedValue(consumedToken),
    });
    const useCase = new ConfirmSubscriptionClaimUseCase(
      makeTransactionalDb(),
      tokensRepo,
      makeAuditRepo(),
      makeUsersRepo() as unknown as UsersRepository,
      makeSubscriptionService(),
      makeStripe()
    );
    const result = await useCase.execute(
      99,
      'used-token',
      'ip-hash',
      'email-hash'
    );
    expect(result).toEqual({ success: false, reason: 'already_consumed' });
  });

  it('rejects with user_has_active_sub when current user already has active subscription', async () => {
    const fakeSub = { status: 'active' } as unknown as StripeTypes.Subscription;
    const useCase = new ConfirmSubscriptionClaimUseCase(
      makeTransactionalDb(),
      makeTokensRepo(),
      makeAuditRepo(),
      makeUsersRepo() as unknown as UsersRepository,
      makeSubscriptionService([fakeSub]),
      makeStripe()
    );
    const result = await useCase.execute(
      99,
      'valid-token',
      'ip-hash',
      'email-hash'
    );
    expect(result).toEqual({ success: false, reason: 'user_has_active_sub' });
  });

  it('writes an audit row on every outcome', async () => {
    const auditRepo = makeAuditRepo();
    const tokensRepo = makeTokensRepo({
      findByTokenHash: vi.fn().mockResolvedValue(null),
    });
    const useCase = new ConfirmSubscriptionClaimUseCase(
      makeTransactionalDb(),
      tokensRepo,
      auditRepo,
      makeUsersRepo() as unknown as UsersRepository,
      makeSubscriptionService(),
      makeStripe()
    );
    await useCase.execute(99, 'token', 'ip-hash', 'email-hash');
    expect(auditRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 99 })
    );
  });
});
