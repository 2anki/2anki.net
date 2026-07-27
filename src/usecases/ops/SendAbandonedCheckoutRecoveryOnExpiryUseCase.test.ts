import { SendAbandonedCheckoutRecoveryOnExpiryUseCase } from './SendAbandonedCheckoutRecoveryOnExpiryUseCase';
import type { IAbandonedCheckoutRecoveryRepository } from '../../data_layer/AbandonedCheckoutRecoveryRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type { EventsSink } from '../../services/events/EventsSink';

jest.mock('../../lib/misc/hashToken', () => (s: string) => `hashed:${s}`);

function makeEventsSink(): jest.Mocked<Pick<EventsSink, 'record'>> {
  return { record: jest.fn() };
}

function makeRepo(
  claimed = true,
  optedOut = false,
  alreadyPaying = false,
  recentlySent = false
): jest.Mocked<IAbandonedCheckoutRecoveryRepository> {
  return {
    claimSession: jest.fn().mockResolvedValue(claimed),
    recordEmailSend: jest.fn().mockResolvedValue(undefined),
    isMarketingOptedOut: jest.fn().mockResolvedValue(optedOut),
    hasLifetimeOrActiveSubscription: jest.fn().mockResolvedValue(alreadyPaying),
    hasSendSince: jest.fn().mockResolvedValue(recentlySent),
    getRecoveryByToken: jest.fn().mockResolvedValue(null),
  };
}

function makeEmailService(): jest.Mocked<IEmailService> {
  return {
    sendResetEmail: jest.fn(),
    sendConversionEmail: jest.fn(),
    sendConversionLinkEmail: jest.fn(),
    sendContactEmail: jest.fn(),
    sendSubscriptionCancelledEmail: jest.fn(),
    sendSubscriptionScheduledCancellationEmail: jest.fn(),
    sendSubscriptionResumingSoonEmail: jest.fn().mockResolvedValue(undefined),
    sendHostedAnkiAccessRequestEmail: jest.fn(),
    sendApiUsageWarningEmail: jest.fn().mockResolvedValue(undefined),
    sendMagicLinkEmail: jest.fn(),
    sendReEngagementEmail: jest.fn(),
    sendInactivityWarningEmail: jest.fn(),
    sendAbandonedCheckoutRecoveryEmail: jest.fn().mockResolvedValue(undefined),
    sendPassWinbackEmail: jest.fn().mockResolvedValue(undefined),
    sendParserCanaryAlert: jest.fn().mockResolvedValue(undefined),
    sendNotionReconnectEmail: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionClaimConfirmation: jest.fn().mockResolvedValue(undefined),
    sendPassClaimConfirmation: jest.fn().mockResolvedValue(undefined),
    sendPriceLockInEmail: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionRecoveryEmail: jest.fn().mockResolvedValue(undefined),
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
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
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
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
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

    const claimToken = (repo.claimSession as jest.Mock).mock.calls[0][2];
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
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
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
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-20T12:00:00Z'));
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
    jest.useRealTimers();
  });

  it('skips with warn log when email is missing', async () => {
    const repo = makeRepo(true);
    const emailService = makeEmailService();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
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
    const repo: jest.Mocked<IAbandonedCheckoutRecoveryRepository> = {
      claimSession: jest.fn().mockImplementation(() => {
        return Promise.resolve(claimCalls.shift() ?? false);
      }),
      recordEmailSend: jest.fn().mockResolvedValue(undefined),
      isMarketingOptedOut: jest.fn().mockResolvedValue(false),
      hasLifetimeOrActiveSubscription: jest.fn().mockResolvedValue(false),
      hasSendSince: jest.fn().mockResolvedValue(false),
      getRecoveryByToken: jest.fn().mockResolvedValue(null),
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
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
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
