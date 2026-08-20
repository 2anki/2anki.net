import { SendPassWinbackUseCase } from './SendPassWinbackUseCase';
import { InMemoryPassWinbackRepository } from '../../data_layer/PassWinbackRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type { EventsSink } from '../../services/events/EventsSink';

const CAMPAIGN = 'winback-2026-fall';

function makeEventsSink(): jest.Mocked<Pick<EventsSink, 'record'>> {
  return { record: jest.fn() };
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
    sendMagicLinkEmail: jest.fn(),
    sendReEngagementEmail: jest.fn(),
    sendInactivityWarningEmail: jest.fn(),
    sendAbandonedCheckoutRecoveryEmail: jest.fn().mockResolvedValue(undefined),
    sendPassWinbackEmail: jest.fn().mockResolvedValue(undefined),
    sendParserCanaryAlert: jest.fn().mockResolvedValue(undefined),
    sendNotionReconnectEmail: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionClaimConfirmation: jest.fn().mockResolvedValue(undefined),
    sendPassClaimConfirmation: jest.fn().mockResolvedValue(undefined),
    sendAnonymousPassClaimEmail: jest.fn().mockResolvedValue(undefined),
    sendContactConfirmationEmail: jest.fn().mockResolvedValue(undefined),
    sendPriceLockInEmail: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionRecoveryEmail: jest.fn().mockResolvedValue(undefined),
  };
}

describe('SendPassWinbackUseCase', () => {
  it('counts candidates without sending or claiming on a dry run', async () => {
    const repo = new InMemoryPassWinbackRepository();
    repo.seedBuyers([
      { id: 1, name: 'Ada', email: 'ada@example.com' },
      { id: 2, name: 'Bo', email: 'bo@example.com' },
    ]);
    const emailService = makeEmailService();
    const useCase = new SendPassWinbackUseCase(repo, emailService);

    const result = await useCase.execute(CAMPAIGN, true);

    expect(result).toEqual({ campaign: CAMPAIGN, count: 2, dryRun: true });
    expect(emailService.sendPassWinbackEmail).not.toHaveBeenCalled();
    expect(repo.getClaims()).toHaveLength(0);
  });

  it('sends to a lapsed pass buyer, claims the send, and records the batch event', async () => {
    const repo = new InMemoryPassWinbackRepository();
    repo.seedBuyers([{ id: 7, name: 'Ada', email: 'ada@example.com' }]);
    const emailService = makeEmailService();
    const eventsSink = makeEventsSink();
    const useCase = new SendPassWinbackUseCase(
      repo,
      emailService,
      async () => false,
      eventsSink
    );

    const result = await useCase.execute(CAMPAIGN, false);

    expect(result).toEqual({ campaign: CAMPAIGN, count: 1, dryRun: false });
    expect(emailService.sendPassWinbackEmail).toHaveBeenCalledWith(
      'ada@example.com',
      expect.any(String)
    );
    expect(repo.getClaims()).toEqual([{ userId: 7, campaign: CAMPAIGN }]);
    expect(eventsSink.record).toHaveBeenCalledWith({
      name: 'email_batch_sent',
      props: { campaign: CAMPAIGN, count: 1 },
    });
  });

  it('skips a hard-suppressed address without claiming or sending', async () => {
    const repo = new InMemoryPassWinbackRepository();
    repo.seedBuyers([{ id: 3, name: 'Su', email: 'bounced@example.com' }]);
    const emailService = makeEmailService();
    const useCase = new SendPassWinbackUseCase(
      repo,
      emailService,
      async (email) => email === 'bounced@example.com'
    );

    const result = await useCase.execute(CAMPAIGN, false);

    expect(result.count).toBe(0);
    expect(emailService.sendPassWinbackEmail).not.toHaveBeenCalled();
    expect(repo.getClaims()).toHaveLength(0);
  });

  it('does not email a buyer already sent this campaign', async () => {
    const repo = new InMemoryPassWinbackRepository();
    repo.seedBuyers([{ id: 5, name: 'Al', email: 'al@example.com' }]);
    repo.seedClaim(5, CAMPAIGN, 'existing-token');
    const emailService = makeEmailService();
    const useCase = new SendPassWinbackUseCase(repo, emailService);

    const result = await useCase.execute(CAMPAIGN, false);

    expect(result.count).toBe(0);
    expect(emailService.sendPassWinbackEmail).not.toHaveBeenCalled();
  });

  it('is idempotent across two runs of the same campaign', async () => {
    const repo = new InMemoryPassWinbackRepository();
    repo.seedBuyers([{ id: 9, name: 'Em', email: 'em@example.com' }]);
    const emailService = makeEmailService();
    const useCase = new SendPassWinbackUseCase(repo, emailService);

    await useCase.execute(CAMPAIGN, false);
    const second = await useCase.execute(CAMPAIGN, false);

    expect(emailService.sendPassWinbackEmail).toHaveBeenCalledTimes(1);
    expect(second.count).toBe(0);
  });

  it('passes the same token to the claim and the email so unsubscribe resolves', async () => {
    const repo = new InMemoryPassWinbackRepository();
    repo.seedBuyers([{ id: 11, name: 'Jo', email: 'jo@example.com' }]);
    const emailService = makeEmailService();
    const useCase = new SendPassWinbackUseCase(repo, emailService);

    await useCase.execute(CAMPAIGN, false);

    const [, emailToken] = emailService.sendPassWinbackEmail.mock.calls[0];
    const resolved = await repo.findByToken(emailToken as string);
    expect(resolved).toEqual({ id: expect.any(Number), userId: 11 });
  });
});
