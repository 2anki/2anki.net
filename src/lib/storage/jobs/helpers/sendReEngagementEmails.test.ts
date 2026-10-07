import { vi, type Mocked } from 'vitest';
import { sendReEngagementEmails } from './sendReEngagementEmails';
import { InMemoryReEngagementRepository } from '../../../../data_layer/ReEngagementRepository';
import type { IEmailService } from '../../../../services/EmailService/EmailService';

function buildEmailService(): Mocked<IEmailService> {
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
    sendReEngagementEmail: vi.fn().mockResolvedValue(undefined),
    sendInactivityWarningEmail: vi.fn().mockResolvedValue(undefined),
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

describe('sendReEngagementEmails', () => {
  it('sends an email for each eligible user', async () => {
    const repo = new InMemoryReEngagementRepository();
    repo.seedUsers([
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
    ]);
    const emailService = buildEmailService();

    await sendReEngagementEmails(repo, emailService);

    expect(emailService.sendReEngagementEmail).toHaveBeenCalledTimes(2);
    expect(emailService.sendReEngagementEmail).toHaveBeenCalledWith(
      'alice@example.com',
      'Alice',
      expect.any(String)
    );
    expect(emailService.sendReEngagementEmail).toHaveBeenCalledWith(
      'bob@example.com',
      'Bob',
      expect.any(String)
    );
  });

  it('records the send in the repository before emailing', async () => {
    const repo = new InMemoryReEngagementRepository();
    repo.seedUsers([{ id: 3, name: 'Carol', email: 'carol@example.com' }]);
    const emailService = buildEmailService();

    await sendReEngagementEmails(repo, emailService);

    const emails = repo.getEmails();
    expect(emails).toHaveLength(1);
    expect(emails[0].userId).toBe(3);
    expect(emails[0].token).toHaveLength(64);
  });

  it('generates a unique 64-character hex token per user', async () => {
    const repo = new InMemoryReEngagementRepository();
    repo.seedUsers([
      { id: 4, name: 'Dave', email: 'dave@example.com' },
      { id: 5, name: 'Eve', email: 'eve@example.com' },
    ]);
    const emailService = buildEmailService();

    await sendReEngagementEmails(repo, emailService);

    const emails = repo.getEmails();
    const tokens = emails.map((e) => e.token);
    expect(tokens[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it('does nothing when there are no eligible users', async () => {
    const repo = new InMemoryReEngagementRepository();
    const emailService = buildEmailService();

    await sendReEngagementEmails(repo, emailService);

    expect(emailService.sendReEngagementEmail).not.toHaveBeenCalled();
    expect(repo.getEmails()).toHaveLength(0);
  });

  it('does not email a user already marked as sent', async () => {
    const repo = new InMemoryReEngagementRepository();
    repo.seedUsers([{ id: 6, name: 'Frank', email: 'frank@example.com' }]);
    const emailService = buildEmailService();

    await sendReEngagementEmails(repo, emailService);
    await sendReEngagementEmails(repo, emailService);

    expect(emailService.sendReEngagementEmail).toHaveBeenCalledTimes(1);
  });

  it('continues to next user when sendReEngagementEmail throws', async () => {
    const repo = new InMemoryReEngagementRepository();
    repo.seedUsers([
      { id: 7, name: 'Grace', email: 'grace@example.com' },
      { id: 8, name: 'Heidi', email: 'heidi@example.com' },
    ]);
    const emailService = buildEmailService();
    emailService.sendReEngagementEmail
      .mockRejectedValueOnce(new Error('SendGrid error'))
      .mockResolvedValueOnce(undefined);

    await expect(
      sendReEngagementEmails(repo, emailService)
    ).resolves.toMatchObject({ count: expect.any(Number) });
    expect(emailService.sendReEngagementEmail).toHaveBeenCalledTimes(2);
  });
});
