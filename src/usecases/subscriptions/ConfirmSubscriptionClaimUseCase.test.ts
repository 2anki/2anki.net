import { vi, type Mocked } from 'vitest';
import { ConfirmSubscriptionClaimUseCase } from './ConfirmSubscriptionClaimUseCase';
import type { ISubscriptionClaimTokensRepository } from '../../data_layer/SubscriptionClaimTokensRepository';
import type { ISubscriptionClaimAuditRepository } from '../../data_layer/SubscriptionClaimAuditRepository';
import type { SubscriptionService } from '../../services/SubscriptionService';
import type StripeTypes from 'stripe';
import type SubscriptionClaimTokens from '../../data_layer/public/SubscriptionClaimTokens';
import knexLib, { type Knex } from 'knex';
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

  // A unique-key clash in the transaction (another row already links the
  // claimant, or another account holds the customer id) reads as a race.
  it('returns race when the claim hits a unique key', async () => {
    const useCase = new ConfirmSubscriptionClaimUseCase(
      makeTransactionalDb(true),
      makeTokensRepo(),
      makeAuditRepo(),
      makeUsersRepo() as unknown as UsersRepository,
      makeSubscriptionService(),
      makeStripe()
    );

    const result = await useCase.execute(99, 'token', 'ip-hash', 'email-hash');

    expect(result).toEqual({ success: false, reason: 'race' });
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

describe('ConfirmSubscriptionClaimUseCase against a real database', () => {
  let db: Knex;

  beforeEach(async () => {
    db = knexLib({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable('users', (t) => {
      t.increments('id');
      t.string('email');
      t.string('stripe_customer_id').unique();
    });
    await db.schema.createTable('subscriptions', (t) => {
      t.increments('id');
      t.string('email').unique();
      t.boolean('active');
      t.json('payload');
      t.string('stripe_product_id');
      t.string('linked_email').unique();
      t.timestamp('created_at');
      t.timestamp('updated_at');
    });
    await db.schema.createTable('developer_tiers', (t) => {
      t.increments('id');
      t.string('tier_key');
      t.string('stripe_product_id');
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  const stripeWith = (subscription: Record<string, unknown>) =>
    ({
      customers: {
        retrieve: vi.fn().mockResolvedValue({
          id: 'cus_test',
          email: 'payer@example.com',
          subscriptions: { data: [subscription] },
        }),
      },
    }) as unknown as Mocked<StripeTypes>;

  const activeSubscription = (metadata: Record<string, string>) => ({
    id: 'sub_claim',
    status: 'active',
    customer: 'cus_test',
    cancel_at_period_end: false,
    cancel_at: null,
    pause_collection: null,
    metadata,
    items: { data: [{ price: { product: 'prod_auto_sync' } }] },
  });

  const useCaseFor = (stripe: Mocked<StripeTypes>) =>
    new ConfirmSubscriptionClaimUseCase(
      db,
      makeTokensRepo(),
      makeAuditRepo(),
      makeUsersRepo() as unknown as UsersRepository,
      makeSubscriptionService(),
      stripe
    );

  it('does not report success when the subscription belongs to another account', async () => {
    await db('users').insert([
      { id: 5, email: 'other@example.com' },
      { id: 99, email: 'user@example.com' },
    ]);

    const result = await useCaseFor(
      stripeWith(activeSubscription({ user_id: '5' }))
    ).execute(99, 'raw-token', 'ip-hash', 'email-hash');

    expect(result).toEqual({ success: false, reason: 'race' });
    expect(await db('subscriptions').select('email')).toEqual([]);
  });

  it('links an unlinked payment to the claimant', async () => {
    await db('users').insert({ id: 99, email: 'user@example.com' });

    const result = await useCaseFor(stripeWith(activeSubscription({}))).execute(
      99,
      'raw-token',
      'ip-hash',
      'email-hash'
    );

    expect(result).toEqual({ success: true });
    expect(
      await db('subscriptions')
        .where({ email: 'payer@example.com' })
        .select('linked_email')
    ).toEqual([{ linked_email: 'user@example.com' }]);
  });
});
