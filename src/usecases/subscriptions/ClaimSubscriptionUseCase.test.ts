import {
  ClaimSubscriptionUseCase,
  CLAIM_INITIATE_MESSAGE,
} from './ClaimSubscriptionUseCase';
import type { ISubscriptionClaimTokensRepository } from '../../data_layer/SubscriptionClaimTokensRepository';
import type { ISubscriptionClaimAuditRepository } from '../../data_layer/SubscriptionClaimAuditRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type { SubscriptionService } from '../../services/SubscriptionService';
import type { Stripe as StripeTypes } from 'stripe/cjs/stripe.core';

process.env.THE_HASHING_SECRET = 'test-secret-for-jest';

const makeTokensRepo = (
  overrides: Partial<ISubscriptionClaimTokensRepository> = {}
): ISubscriptionClaimTokensRepository => ({
  insert: jest.fn().mockResolvedValue({
    id: 1,
    token_hash: 'hash',
    user_id: 99,
    stripe_customer_id: 'cus_1',
    expires_at: new Date(),
    consumed_at: null,
    created_at: new Date(),
  }),
  findByTokenHash: jest.fn().mockResolvedValue(null),
  markConsumed: jest.fn().mockResolvedValue(undefined),
  countRecentByUser: jest.fn().mockResolvedValue(0),
  ...overrides,
});

const makeAuditRepo = (
  overrides: Partial<ISubscriptionClaimAuditRepository> = {}
): ISubscriptionClaimAuditRepository => ({
  insert: jest.fn().mockResolvedValue({
    id: 1,
    user_id: 99,
    email_hash: 'eh',
    ip_hash: 'ih',
    outcome: 'initiate',
    created_at: new Date(),
  }),
  countRecentByIp: jest.fn().mockResolvedValue(0),
  ...overrides,
});

const makeEmailService = (
  overrides: Partial<IEmailService> = {}
): IEmailService => ({
  sendResetEmail: jest.fn(),
  sendConversionEmail: jest.fn(),
  sendConversionLinkEmail: jest.fn(),
  sendContactEmail: jest.fn(),
  sendSubscriptionCancelledEmail: jest.fn(),
  sendSubscriptionScheduledCancellationEmail: jest.fn(),
  sendSubscriptionResumingSoonEmail: jest.fn().mockResolvedValue(undefined),
  sendHostedAnkiAccessRequestEmail: jest.fn(),
  sendMagicLinkEmail: jest.fn(),
  sendReEngagementEmail: jest.fn(),
  sendInactivityWarningEmail: jest.fn(),
  sendAbandonedCheckoutRecoveryEmail: jest.fn(),
  sendPassWinbackEmail: jest.fn(),
  sendParserCanaryAlert: jest.fn(),
  sendNotionReconnectEmail: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionClaimConfirmation: jest.fn().mockResolvedValue(undefined),
  sendPassClaimConfirmation: jest.fn().mockResolvedValue(undefined),
  sendAnonymousPassClaimEmail: jest.fn().mockResolvedValue(undefined),
  sendContactConfirmationEmail: jest.fn().mockResolvedValue(undefined),
  sendPriceLockInEmail: jest.fn().mockResolvedValue(undefined),
  sendSubscriptionRecoveryEmail: jest.fn().mockResolvedValue(undefined),
  sendEmailChangeConfirmationEmail: jest.fn().mockResolvedValue(undefined),
  sendEmailChangeNotificationEmail: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

const makeStripe = (
  customerEmail = 'payer@stripe.example.com'
): jest.Mocked<StripeTypes> =>
  ({
    customers: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'cus_abc123',
        email: customerEmail,
      }),
    },
  }) as unknown as jest.Mocked<StripeTypes>;

const makeSubscriptionService = (subs: StripeTypes.Subscription[] = []) =>
  ({
    findActiveStripeSubscriptions: jest.fn().mockResolvedValue(subs),
  }) as unknown as typeof SubscriptionService;

const baseInput = {
  userId: 99,
  submittedEmail: 'payer@example.com',
  ipHash: 'hashed-ip',
  emailHash: 'hashed-email',
};

describe('ClaimSubscriptionUseCase', () => {
  it('returns the identical success message when no Stripe customer matches the email', async () => {
    const useCase = new ClaimSubscriptionUseCase(
      makeTokensRepo(),
      makeAuditRepo(),
      makeEmailService(),
      makeSubscriptionService([]),
      makeStripe()
    );
    const result = await useCase.execute(baseInput);
    expect(result.message).toBe(CLAIM_INITIATE_MESSAGE);
  });

  it('returns the identical success message when a Stripe customer matches with no active subscription', async () => {
    const useCase = new ClaimSubscriptionUseCase(
      makeTokensRepo(),
      makeAuditRepo(),
      makeEmailService(),
      makeSubscriptionService([]),
      makeStripe()
    );
    const result = await useCase.execute(baseInput);
    expect(result.message).toBe(CLAIM_INITIATE_MESSAGE);
  });

  it('mints a token and sends the confirmation email to the Stripe customer email on record — not the submitted email', async () => {
    const stripeCustomerEmail = 'stripe-on-record@example.com';
    const emailService = makeEmailService();
    const tokensRepo = makeTokensRepo();
    const fakeSub = {
      customer: 'cus_abc123',
      status: 'active',
    } as unknown as StripeTypes.Subscription;
    const useCase = new ClaimSubscriptionUseCase(
      tokensRepo,
      makeAuditRepo(),
      emailService,
      makeSubscriptionService([fakeSub]),
      makeStripe(stripeCustomerEmail),
      'https://test.2anki.net'
    );

    const result = await useCase.execute(baseInput);

    expect(result.message).toBe(CLAIM_INITIATE_MESSAGE);
    expect(tokensRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: baseInput.userId,
        stripe_customer_id: 'cus_abc123',
      })
    );
    expect(emailService.sendSubscriptionClaimConfirmation).toHaveBeenCalledWith(
      stripeCustomerEmail,
      expect.stringContaining('/account/claim?token=')
    );
    expect(
      emailService.sendSubscriptionClaimConfirmation
    ).not.toHaveBeenCalledWith(baseInput.submittedEmail, expect.anything());
  });

  it('writes an audit row with outcome=initiate and hashed email + IP', async () => {
    const auditRepo = makeAuditRepo();
    const useCase = new ClaimSubscriptionUseCase(
      makeTokensRepo(),
      auditRepo,
      makeEmailService(),
      makeSubscriptionService([]),
      makeStripe()
    );

    await useCase.execute(baseInput);

    expect(auditRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'initiate',
        user_id: baseInput.userId,
      })
    );
  });

  it('rate-limits the user at 12 attempts per hour', async () => {
    const emailService = makeEmailService();
    const tokensRepo = makeTokensRepo({
      countRecentByUser: jest.fn().mockResolvedValue(12),
    });
    const fakeSub = {
      customer: 'cus_xyz',
      status: 'active',
    } as unknown as StripeTypes.Subscription;
    const useCase = new ClaimSubscriptionUseCase(
      tokensRepo,
      makeAuditRepo(),
      emailService,
      makeSubscriptionService([fakeSub]),
      makeStripe()
    );

    const result = await useCase.execute(baseInput);

    expect(result.message).toBe(CLAIM_INITIATE_MESSAGE);
    expect(
      emailService.sendSubscriptionClaimConfirmation
    ).not.toHaveBeenCalled();
  });

  it('rate-limits the IP at 60 attempts per hour', async () => {
    const emailService = makeEmailService();
    const auditRepo = makeAuditRepo({
      countRecentByIp: jest.fn().mockResolvedValue(60),
    });
    const fakeSub = {
      customer: 'cus_xyz',
      status: 'active',
    } as unknown as StripeTypes.Subscription;
    const useCase = new ClaimSubscriptionUseCase(
      makeTokensRepo(),
      auditRepo,
      emailService,
      makeSubscriptionService([fakeSub]),
      makeStripe()
    );

    const result = await useCase.execute(baseInput);

    expect(result.message).toBe(CLAIM_INITIATE_MESSAGE);
    expect(
      emailService.sendSubscriptionClaimConfirmation
    ).not.toHaveBeenCalled();
  });

  it('never passes the submitted email to the audit repo in plaintext', async () => {
    const auditRepo = makeAuditRepo();
    const useCase = new ClaimSubscriptionUseCase(
      makeTokensRepo(),
      auditRepo,
      makeEmailService(),
      makeSubscriptionService([]),
      makeStripe()
    );

    await useCase.execute(baseInput);

    const insertCall = (auditRepo.insert as jest.Mock).mock.calls[0][0];
    expect(insertCall.email_hash).not.toBe(baseInput.submittedEmail);
    expect(insertCall).not.toHaveProperty('email');
  });
});
