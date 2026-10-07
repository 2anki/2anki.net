import { vi, type Mock, type Mocked } from 'vitest';
import { SendAbandonedCheckoutRecoveryOnExpiryUseCase } from './SendAbandonedCheckoutRecoveryOnExpiryUseCase';
import type { IAbandonedCheckoutRecoveryRepository } from '../../data_layer/AbandonedCheckoutRecoveryRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type { EventsSink } from '../../services/events/EventsSink';

vi.mock('../../lib/misc/hashToken', () => ({
  default: (s: string) => `hashed:${s}`,
}));

function makeEventsSink(): Mocked<Pick<EventsSink, 'record'>> {
  return { record: vi.fn() };
}

function makeRepo(
  claimed = true,
  optedOut = false,
  alreadyPaying = false,
  recentlySent = false
): Mocked<IAbandonedCheckoutRecoveryRepository> {
  return {
    claimSession: vi.fn().mockResolvedValue(claimed),
    recordEmailSend: vi.fn().mockResolvedValue(undefined),
    isMarketingOptedOut: vi.fn().mockResolvedValue(optedOut),
    hasLifetimeOrActiveSubscription: vi.fn().mockResolvedValue(alreadyPaying),
    hasSendSince: vi.fn().mockResolvedValue(recentlySent),
    getRecoveryByToken: vi.fn().mockResolvedValue(null),
  };
}

function makeEmailService(): Mocked<IEmailService> {
  return {
    sendResetEmail: vi.fn(),
    sendConversionEmail: vi.fn(),
    sendConversionLinkEmail: vi.fn(),
    sendContactEmail: vi.fn(),
    sendSubscriptionCancelledEmail: vi.fn(),
    sendSubscriptionScheduledCancellationEmail: vi.fn(),
    sendSubscriptionResumingSoonEmail: vi.fn().mockResolvedValue(undefined),
    sendHostedAnkiAccessRequestEmail: vi.fn(),
    sendMagicLinkEmail: vi.fn(),
    sendReEngagementEmail: vi.fn(),
    sendInactivityWarningEmail: vi.fn(),
    sendAbandonedCheckoutRecoveryEmail: vi.fn().mockResolvedValue(undefined),
    sendPassWinbackEmail: vi.fn().mockResolvedValue(undefined),
    sendParserCanaryAlert: vi.fn().mockResolvedValue(undefined),
    sendAiSpendAlertEmail: vi.fn().mockResolvedValue(undefined),
    sendNotionReconnectEmail: vi.fn().mockResolvedValue(undefined),
    sendSubscriptionClaimConfirmation: vi.fn().mockResolvedValue(undefined),
    sendPassClaimConfirmation: vi.fn().mockResolvedValue(undefined),
    sendAnonymousPassClaimEmail: vi.fn().mockResolvedValue(undefined),
    sendContactConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendPriceLockInEmail: vi.fn().mockResolvedValue(undefined),
    sendSubscriptionRecoveryEmail: vi.fn().mockResolvedValue(undefined),
    sendEmailChangeConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendEmailChangeNotificationEmail: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SendAbandonedCheckoutRecoveryOnExpiryUseCase', () => {
  it('sends email and claims row when insert wins', async () => {
    const repo = makeRepo(true);
    const emailService = makeEmailService();
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService
    );

    await useCase.execute('cs_test_abc123', 'alice@example.com');

    expect(repo.claimSession).toHaveBeenCalledWith(
      'cs_test_abc123',
      'alice@example.com',
      expect.any(String),
      null
    );
    expect(
      emailService.sendAbandonedCheckoutRecoveryEmail
    ).toHaveBeenCalledWith('alice@example.com', expect.any(String));
  });

  it('passes recovery details through to claimSession when provided', async () => {
    const repo = makeRepo(true);
    const emailService = makeEmailService();
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService
    );
    const recovery = {
      url: 'https://buy.stripe.com/r/live_abc',
      expiresAt: new Date('2026-07-05T00:00:00Z'),
    };

    await useCase.execute('cs_with_recovery', 'alice@example.com', recovery);

    expect(repo.claimSession).toHaveBeenCalledWith(
      'cs_with_recovery',
      'alice@example.com',
      expect.any(String),
      recovery
    );
  });

  it('logs recovery URL presence without logging the URL itself', async () => {
    const repo = makeRepo(true);
    const emailService = makeEmailService();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService
    );

    await useCase.execute('cs_log_check', 'alice@example.com', {
      url: 'https://buy.stripe.com/r/live_secret',
      expiresAt: null,
    });

    expect(infoSpy).toHaveBeenCalledWith(
      'checkout.session.expired.recovery_url',
      {
        present: true,
        session_id_hash: 'hashed:cs_log_check',
      }
    );
    const logged = infoSpy.mock.calls.map((c) => JSON.stringify(c)).join('\n');
    expect(logged).not.toContain('live_secret');
    infoSpy.mockRestore();
  });

  it('logs recovery URL absence when Stripe omitted it', async () => {
    const repo = makeRepo(true);
    const emailService = makeEmailService();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService
    );

    await useCase.execute('cs_no_recovery', 'alice@example.com');

    expect(infoSpy).toHaveBeenCalledWith(
      'checkout.session.expired.recovery_url',
      {
        present: false,
        session_id_hash: 'hashed:cs_no_recovery',
      }
    );
    infoSpy.mockRestore();
  });

  it('passes a non-empty token to the email service', async () => {
    const repo = makeRepo(true);
    const emailService = makeEmailService();
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService
    );

    await useCase.execute('cs_test_tok', 'alice@example.com');

    const [, token] =
      emailService.sendAbandonedCheckoutRecoveryEmail.mock.calls[0];
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('passes the same token to claimSession and the email service', async () => {
    const repo = makeRepo(true);
    const emailService = makeEmailService();
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService
    );

    await useCase.execute('cs_test_same_tok', 'alice@example.com');

    const claimToken = (repo.claimSession as Mock).mock.calls[0][2];
    const [, emailToken] =
      emailService.sendAbandonedCheckoutRecoveryEmail.mock.calls[0];
    expect(claimToken).toBe(emailToken);
  });

  it('does not send email when insert is a no-op (duplicate)', async () => {
    const repo = makeRepo(false);
    const emailService = makeEmailService();
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService
    );

    await useCase.execute('cs_test_abc123', 'alice@example.com');

    expect(repo.claimSession).toHaveBeenCalledWith(
      'cs_test_abc123',
      'alice@example.com',
      expect.any(String),
      null
    );
    expect(
      emailService.sendAbandonedCheckoutRecoveryEmail
    ).not.toHaveBeenCalled();
  });

  it('does not send email when the user has opted out of marketing', async () => {
    const repo = makeRepo(true, true);
    const emailService = makeEmailService();
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService
    );

    await useCase.execute('cs_opted_out', 'optout@example.com');

    expect(repo.isMarketingOptedOut).toHaveBeenCalledWith('optout@example.com');
    expect(repo.claimSession).not.toHaveBeenCalled();
    expect(
      emailService.sendAbandonedCheckoutRecoveryEmail
    ).not.toHaveBeenCalled();
  });

  it('does not send when the recipient has lifetime or an active subscription', async () => {
    const repo = makeRepo(true, false, true);
    const emailService = makeEmailService();
    const eventsSink = makeEventsSink();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService,
      eventsSink
    );

    await useCase.execute('cs_lifetime', 'lifetime@example.com');

    expect(repo.hasLifetimeOrActiveSubscription).toHaveBeenCalledWith(
      'lifetime@example.com'
    );
    expect(repo.claimSession).not.toHaveBeenCalled();
    expect(
      emailService.sendAbandonedCheckoutRecoveryEmail
    ).not.toHaveBeenCalled();
    expect(eventsSink.record).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      'checkout.session.expired.already_paying',
      { session_id_hash: 'hashed:cs_lifetime' }
    );
    infoSpy.mockRestore();
  });

  it('does not send when a recovery email already went to the address recently', async () => {
    const repo = makeRepo(true, false, false, true);
    const emailService = makeEmailService();
    const eventsSink = makeEventsSink();
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService,
      eventsSink
    );

    await useCase.execute('cs_second_session', 'alice@example.com');

    expect(repo.claimSession).not.toHaveBeenCalled();
    expect(
      emailService.sendAbandonedCheckoutRecoveryEmail
    ).not.toHaveBeenCalled();
    expect(eventsSink.record).not.toHaveBeenCalled();
  });

  it('checks recent sends against a cutoff 7 days back', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00Z'));
    const repo = makeRepo(true);
    const emailService = makeEmailService();
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService
    );

    await useCase.execute('cs_window', 'alice@example.com');

    expect(repo.hasSendSince).toHaveBeenCalledWith(
      'alice@example.com',
      new Date('2026-07-13T12:00:00Z')
    );
    vi.useRealTimers();
  });

  it('skips with warn log when email is missing', async () => {
    const repo = makeRepo(true);
    const emailService = makeEmailService();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService
    );

    await useCase.execute('cs_test_no_email', null);

    expect(repo.claimSession).not.toHaveBeenCalled();
    expect(
      emailService.sendAbandonedCheckoutRecoveryEmail
    ).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'checkout.session.expired.no_email',
      expect.objectContaining({ session_id_hash: expect.any(String) })
    );
    warnSpy.mockRestore();
  });

  it('idempotent — second execution with same session does not double-send', async () => {
    const claimCalls: boolean[] = [true, false];
    const repo: Mocked<IAbandonedCheckoutRecoveryRepository> = {
      claimSession: vi.fn().mockImplementation(() => {
        return Promise.resolve(claimCalls.shift() ?? false);
      }),
      recordEmailSend: vi.fn().mockResolvedValue(undefined),
      isMarketingOptedOut: vi.fn().mockResolvedValue(false),
      hasLifetimeOrActiveSubscription: vi.fn().mockResolvedValue(false),
      hasSendSince: vi.fn().mockResolvedValue(false),
      getRecoveryByToken: vi.fn().mockResolvedValue(null),
    };
    const emailService = makeEmailService();
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService
    );

    await useCase.execute('cs_test_dup', 'bob@example.com');
    await useCase.execute('cs_test_dup', 'bob@example.com');

    expect(
      emailService.sendAbandonedCheckoutRecoveryEmail
    ).toHaveBeenCalledTimes(1);
  });

  it('emits email_batch_sent with campaign=abandoned_checkout and count 1 on a real send', async () => {
    const repo = makeRepo(true);
    const emailService = makeEmailService();
    const eventsSink = makeEventsSink();
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService,
      eventsSink
    );

    await useCase.execute('cs_test_event', 'alice@example.com');

    expect(eventsSink.record).toHaveBeenCalledWith({
      name: 'email_batch_sent',
      props: { campaign: 'abandoned_checkout', count: 1 },
    });
  });

  it('does not emit when the user opted out of marketing', async () => {
    const repo = makeRepo(true, true);
    const emailService = makeEmailService();
    const eventsSink = makeEventsSink();
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService,
      eventsSink
    );

    await useCase.execute('cs_opted_out', 'optout@example.com');

    expect(eventsSink.record).not.toHaveBeenCalled();
  });

  it('does not emit when the email is missing', async () => {
    const repo = makeRepo(true);
    const emailService = makeEmailService();
    const eventsSink = makeEventsSink();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService,
      eventsSink
    );

    await useCase.execute('cs_test_no_email', null);

    expect(eventsSink.record).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not emit when the claim is a no-op duplicate', async () => {
    const repo = makeRepo(false);
    const emailService = makeEmailService();
    const eventsSink = makeEventsSink();
    const useCase = new SendAbandonedCheckoutRecoveryOnExpiryUseCase(
      repo,
      emailService,
      eventsSink
    );

    await useCase.execute('cs_test_dup_event', 'alice@example.com');

    expect(eventsSink.record).not.toHaveBeenCalled();
  });
});
