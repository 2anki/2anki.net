import { vi } from 'vitest';
import { MarkNotionTokenInvalidUseCase } from './MarkNotionTokenInvalidUseCase';
import { INotionRepository } from '../../data_layer/NotionRespository';
import { IEmailService } from '../../services/EmailService/EmailService';
import { IMarkNotionTokenInvalidUsers } from './MarkNotionTokenInvalidUseCase';

function buildNotionRepo(
  overrides: Partial<INotionRepository> = {}
): INotionRepository {
  return {
    getNotionData: vi.fn(),
    saveNotionToken: vi.fn(),
    getNotionToken: vi.fn(),
    deleteBlocksByOwner: vi.fn(),
    deleteNotionData: vi.fn(),
    markTokenInvalid: vi.fn().mockResolvedValue(undefined),
    clearTokenInvalid: vi.fn(),
    setReconnectEmailSent: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function buildUsers(...args: [string?]): IMarkNotionTokenInvalidUsers {
  const email = args.length === 0 ? 'user@example.com' : args[0];
  return {
    getEmailById: vi.fn().mockResolvedValue(email),
  };
}

function buildEmailService(
  overrides: Partial<IEmailService> = {}
): IEmailService {
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
    sendAbandonedCheckoutRecoveryEmail: vi.fn(),
    sendPassWinbackEmail: vi.fn(),
    sendParserCanaryAlert: vi.fn(),
    sendAiSpendAlertEmail: vi.fn(),
    sendNotionReconnectEmail: vi.fn().mockResolvedValue(undefined),
    sendSubscriptionClaimConfirmation: vi.fn().mockResolvedValue(undefined),
    sendPassClaimConfirmation: vi.fn().mockResolvedValue(undefined),
    sendAnonymousPassClaimEmail: vi.fn().mockResolvedValue(undefined),
    sendContactConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendPriceLockInEmail: vi.fn().mockResolvedValue(undefined),
    sendSubscriptionRecoveryEmail: vi.fn().mockResolvedValue(undefined),
    sendEmailChangeConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendEmailChangeNotificationEmail: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('MarkNotionTokenInvalidUseCase', () => {
  const OWNER = 42;

  it('calls markTokenInvalid on the repository', async () => {
    const notion = buildNotionRepo();
    const useCase = new MarkNotionTokenInvalidUseCase(
      notion,
      buildUsers(),
      buildEmailService()
    );

    await useCase.execute(OWNER);

    expect(notion.markTokenInvalid).toHaveBeenCalledWith(OWNER);
  });

  it('looks up the recipient via getEmailById', async () => {
    const users = buildUsers('alice@example.com');
    const useCase = new MarkNotionTokenInvalidUseCase(
      buildNotionRepo(),
      users,
      buildEmailService()
    );

    await useCase.execute(OWNER);

    expect(users.getEmailById).toHaveBeenCalledWith(OWNER);
  });

  it('claims the gate atomically via setReconnectEmailSent before sending', async () => {
    const sendOrder: string[] = [];
    const notion = buildNotionRepo({
      setReconnectEmailSent: vi.fn().mockImplementation(async () => {
        sendOrder.push('gate');
        return true;
      }),
    });
    const emailService = buildEmailService({
      sendNotionReconnectEmail: vi.fn().mockImplementation(async () => {
        sendOrder.push('send');
      }),
    });
    const useCase = new MarkNotionTokenInvalidUseCase(
      notion,
      buildUsers(),
      emailService
    );

    await useCase.execute(OWNER);

    expect(sendOrder).toEqual(['gate', 'send']);
  });

  it('sends the email when the gate claim succeeds', async () => {
    const emailService = buildEmailService();
    const useCase = new MarkNotionTokenInvalidUseCase(
      buildNotionRepo({
        setReconnectEmailSent: vi.fn().mockResolvedValue(true),
      }),
      buildUsers('alice@example.com'),
      emailService
    );

    await useCase.execute(OWNER);

    expect(emailService.sendNotionReconnectEmail).toHaveBeenCalledWith(
      'alice@example.com'
    );
  });

  it('does NOT send when the gate claim returns false', async () => {
    const emailService = buildEmailService();
    const useCase = new MarkNotionTokenInvalidUseCase(
      buildNotionRepo({
        setReconnectEmailSent: vi.fn().mockResolvedValue(false),
      }),
      buildUsers(),
      emailService
    );

    await useCase.execute(OWNER);

    expect(emailService.sendNotionReconnectEmail).not.toHaveBeenCalled();
  });

  it('does NOT send when getEmailById returns undefined', async () => {
    const emailService = buildEmailService();
    const useCase = new MarkNotionTokenInvalidUseCase(
      buildNotionRepo(),
      buildUsers(undefined),
      emailService
    );

    await useCase.execute(OWNER);

    expect(emailService.sendNotionReconnectEmail).not.toHaveBeenCalled();
  });

  it('does NOT throw when email send fails — caller is fire-and-forget', async () => {
    const emailService = buildEmailService({
      sendNotionReconnectEmail: vi
        .fn()
        .mockRejectedValue(new Error('SendGrid down')),
    });
    const useCase = new MarkNotionTokenInvalidUseCase(
      buildNotionRepo(),
      buildUsers(),
      emailService
    );

    await expect(useCase.execute(OWNER)).resolves.not.toThrow();
  });

  it('does NOT log the recipient email address on failure', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const emailService = buildEmailService({
      sendNotionReconnectEmail: vi
        .fn()
        .mockRejectedValue(new Error('SendGrid down')),
    });
    const useCase = new MarkNotionTokenInvalidUseCase(
      buildNotionRepo(),
      buildUsers('sensitive@example.com'),
      emailService
    );

    await useCase.execute(OWNER);

    const allWarnArgs = warnSpy.mock.calls.flat();
    const allText = allWarnArgs.map((a) => JSON.stringify(a)).join(' ');
    expect(allText).not.toContain('sensitive@example.com');

    warnSpy.mockRestore();
  });

  it('logs owner id and a reason code on every non-happy path', async () => {
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const useCaseNoEmail = new MarkNotionTokenInvalidUseCase(
      buildNotionRepo(),
      buildUsers(undefined),
      buildEmailService()
    );
    await useCaseNoEmail.execute(OWNER);
    expect(warnSpy).toHaveBeenCalledWith(
      '[notion-reconnect] no_email_on_file',
      expect.objectContaining({ owner: OWNER })
    );

    warnSpy.mockClear();

    const failingEmailService = buildEmailService({
      sendNotionReconnectEmail: vi.fn().mockRejectedValue(new Error('fail')),
    });
    const useCaseSendFail = new MarkNotionTokenInvalidUseCase(
      buildNotionRepo(),
      buildUsers('someone@example.com'),
      failingEmailService
    );
    await useCaseSendFail.execute(OWNER);
    expect(warnSpy).toHaveBeenCalledWith(
      '[notion-reconnect] email_send_failed',
      expect.objectContaining({ owner: OWNER })
    );

    warnSpy.mockRestore();
  });
});
