import { ClaimPassUseCase } from './ClaimPassUseCase';
import { InMemoryAnonymousPassRepository } from '../../data_layer/AnonymousPassRepository';
import type { IPassClaimTokensRepository } from '../../data_layer/PassClaimTokensRepository';
import type { ISubscriptionClaimAuditRepository } from '../../data_layer/SubscriptionClaimAuditRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import { emailHash } from '../../lib/emailHash';

process.env.THE_HASHING_SECRET = 'test-secret-for-jest';

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function makeTokensRepo(
  overrides: Partial<IPassClaimTokensRepository> = {}
): IPassClaimTokensRepository {
  return {
    insert: jest.fn().mockResolvedValue({ id: 1 }),
    findByTokenHash: jest.fn().mockResolvedValue(null),
    markConsumed: jest.fn().mockResolvedValue(undefined),
    countRecentByUser: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makeAuditRepo(
  overrides: Partial<ISubscriptionClaimAuditRepository> = {}
): ISubscriptionClaimAuditRepository {
  return {
    insert: jest.fn().mockResolvedValue({}),
    countRecentByIp: jest.fn().mockResolvedValue(0),
    ...overrides,
  } as ISubscriptionClaimAuditRepository;
}

function makeEmailService(): IEmailService {
  return {
    sendPassClaimConfirmation: jest.fn().mockResolvedValue(undefined),
  } as unknown as IEmailService;
}

function makeStripe(sessionEmail: string | null = null) {
  return {
    checkout: {
      sessions: {
        retrieve: jest.fn().mockResolvedValue({
          customer_details: { email: sessionEmail },
        }),
      },
    },
  } as never;
}

const input = (email: string) => ({
  userId: 42,
  submittedEmail: email,
  ipHash: 'ip-hash',
  emailHash: emailHash(email),
});

describe('ClaimPassUseCase', () => {
  it('sends a confirmation email when an unclaimed pass matches the email', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    await anonRepo.insert({
      stripeSessionId: 'cs_1',
      kind: '7d',
      expiresAt: FUTURE,
      paymentIntentId: 'pi_1',
      buyerEmailHash: emailHash('buyer@example.com'),
    });
    const tokensRepo = makeTokensRepo();
    const emailService = makeEmailService();
    const useCase = new ClaimPassUseCase(
      anonRepo,
      tokensRepo,
      makeAuditRepo(),
      emailService,
      makeStripe(),
      'https://2anki.net'
    );

    await useCase.execute(input('buyer@example.com'));

    expect(tokensRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 42, anonymous_pass_id: 1 })
    );
    expect(emailService.sendPassClaimConfirmation).toHaveBeenCalledWith(
      'buyer@example.com',
      expect.stringContaining('/account/claim?token='),
      'Week Pass'
    );
    const url = (emailService.sendPassClaimConfirmation as jest.Mock).mock
      .calls[0][1] as string;
    expect(url).toContain('kind=pass');
  });

  it('sends nothing when no pass matches', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    const tokensRepo = makeTokensRepo();
    const emailService = makeEmailService();
    const useCase = new ClaimPassUseCase(
      anonRepo,
      tokensRepo,
      makeAuditRepo(),
      emailService,
      makeStripe()
    );

    await useCase.execute(input('nobody@example.com'));

    expect(tokensRepo.insert).not.toHaveBeenCalled();
    expect(emailService.sendPassClaimConfirmation).not.toHaveBeenCalled();
  });

  it('ignores claimed and expired passes', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    const claimed = await anonRepo.insert({
      stripeSessionId: 'cs_claimed',
      kind: '7d',
      expiresAt: FUTURE,
      paymentIntentId: 'pi_c',
      buyerEmailHash: emailHash('buyer@example.com'),
    });
    await anonRepo.claim(claimed.id, 7);
    await anonRepo.insert({
      stripeSessionId: 'cs_expired',
      kind: '24h',
      expiresAt: new Date('2020-01-01T00:00:00Z'),
      paymentIntentId: 'pi_e',
      buyerEmailHash: emailHash('buyer@example.com'),
    });
    const emailService = makeEmailService();
    const useCase = new ClaimPassUseCase(
      anonRepo,
      makeTokensRepo(),
      makeAuditRepo(),
      emailService,
      makeStripe()
    );

    await useCase.execute(input('buyer@example.com'));

    expect(emailService.sendPassClaimConfirmation).not.toHaveBeenCalled();
  });

  it('backfills a legacy pass with no stored email hash from Stripe, then matches it', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    await anonRepo.insert({
      stripeSessionId: 'cs_legacy',
      kind: '7d',
      expiresAt: FUTURE,
      paymentIntentId: 'pi_l',
    });
    const stripe = makeStripe('buyer@example.com');
    const emailService = makeEmailService();
    const useCase = new ClaimPassUseCase(
      anonRepo,
      makeTokensRepo(),
      makeAuditRepo(),
      emailService,
      stripe
    );

    await useCase.execute(input('buyer@example.com'));

    expect(emailService.sendPassClaimConfirmation).toHaveBeenCalled();
    const stored = await anonRepo.findBySessionId('cs_legacy');
    expect(stored?.buyer_email_hash).toBe(emailHash('buyer@example.com'));
  });

  it('stops at the per-user rate limit without touching the pass table', async () => {
    const anonRepo = new InMemoryAnonymousPassRepository();
    await anonRepo.insert({
      stripeSessionId: 'cs_1',
      kind: '7d',
      expiresAt: FUTURE,
      paymentIntentId: 'pi_1',
      buyerEmailHash: emailHash('buyer@example.com'),
    });
    const emailService = makeEmailService();
    const useCase = new ClaimPassUseCase(
      anonRepo,
      makeTokensRepo({ countRecentByUser: jest.fn().mockResolvedValue(12) }),
      makeAuditRepo(),
      emailService,
      makeStripe()
    );

    await useCase.execute(input('buyer@example.com'));

    expect(emailService.sendPassClaimConfirmation).not.toHaveBeenCalled();
  });
});
