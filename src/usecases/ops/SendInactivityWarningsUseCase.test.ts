import { vi, type Mocked } from 'vitest';
import { SendInactivityWarningsUseCase } from './SendInactivityWarningsUseCase';
import { InMemoryInactivityEmailRepository } from '../../data_layer/InactivityEmailRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import type {
  IUploadRepository,
  LastUpload,
} from '../../data_layer/UploadRespository';

function makeEmailService(
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
    ...overrides,
  };
}

function makeUploadRepo(
  lastUpload: LastUpload | null = null
): Mocked<IUploadRepository> {
  return {
    deleteUpload: vi.fn(),
    getUploadsByOwner: vi.fn(),
    findByIdAndOwner: vi.fn(),
    findByObjectId: vi.fn(),
    findByKey: vi.fn(),
    findAllByObjectIdAndOwner: vi.fn().mockResolvedValue([]),
    update: vi.fn(),
    getLastUploadForUser: vi.fn().mockResolvedValue(lastUpload),
    getLastReconvertibleUpload: vi.fn().mockResolvedValue(null),
    findByOwnerAndDedupeKey: vi.fn().mockResolvedValue(null),
    insertNativeDeck: vi.fn(),
    insertConvertedDeck: vi.fn(),
  };
}

describe('SendInactivityWarningsUseCase', () => {
  let repo: InMemoryInactivityEmailRepository;

  beforeEach(() => {
    repo = new InMemoryInactivityEmailRepository();
  });

  describe('dry run', () => {
    it('returns candidate count without sending emails', async () => {
      repo.seedUsers([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]);
      const emailService = makeEmailService();
      const useCase = new SendInactivityWarningsUseCase(repo, emailService);

      const result = await useCase.execute(true);

      expect(result).toEqual({ count: 2, dryRun: true });
      expect(emailService.sendInactivityWarningEmail).not.toHaveBeenCalled();
      expect(repo.getSentUserIds().size).toBe(0);
    });

    it('respects limit when counting candidates', async () => {
      repo.seedUsers([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
        { id: 3, name: 'Carol', email: 'carol@example.com' },
      ]);
      const useCase = new SendInactivityWarningsUseCase(
        repo,
        makeEmailService()
      );

      const result = await useCase.execute(true, 1);

      expect(result).toEqual({ count: 1, dryRun: true });
    });

    it('returns zero when no candidates exist', async () => {
      const useCase = new SendInactivityWarningsUseCase(
        repo,
        makeEmailService()
      );

      const result = await useCase.execute(true);

      expect(result).toEqual({ count: 0, dryRun: true });
    });
  });

  describe('live send', () => {
    it('sends emails and records sends for each candidate', async () => {
      repo.seedUsers([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]);
      const emailService = makeEmailService();
      const useCase = new SendInactivityWarningsUseCase(repo, emailService);

      const result = await useCase.execute(false);

      expect(result).toEqual({ count: 2, dryRun: false });
      expect(emailService.sendInactivityWarningEmail).toHaveBeenCalledTimes(2);
      expect(emailService.sendInactivityWarningEmail).toHaveBeenCalledWith(
        'alice@example.com',
        expect.any(String),
        null
      );
      expect(emailService.sendInactivityWarningEmail).toHaveBeenCalledWith(
        'bob@example.com',
        expect.any(String),
        null
      );
      expect(repo.getSentUserIds()).toEqual(new Set([1, 2]));
    });

    it('continues sending to remaining users when one email fails', async () => {
      repo.seedUsers([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]);
      const emailService = makeEmailService({
        sendInactivityWarningEmail: vi
          .fn()
          .mockRejectedValueOnce(new Error('SendGrid error'))
          .mockResolvedValueOnce(undefined),
      });
      const useCase = new SendInactivityWarningsUseCase(repo, emailService);

      const result = await useCase.execute(false);

      expect(result.count).toBe(1);
      expect(emailService.sendInactivityWarningEmail).toHaveBeenCalledTimes(2);
    });

    it('returns zero when no candidates exist', async () => {
      const useCase = new SendInactivityWarningsUseCase(
        repo,
        makeEmailService()
      );

      const result = await useCase.execute(false);

      expect(result).toEqual({ count: 0, dryRun: false });
    });

    it('sends only up to limit when fewer candidates exist than default', async () => {
      repo.seedUsers([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
        { id: 3, name: 'Carol', email: 'carol@example.com' },
      ]);
      const emailService = makeEmailService();
      const useCase = new SendInactivityWarningsUseCase(repo, emailService);

      const result = await useCase.execute(false, 2);

      expect(result).toEqual({ count: 2, dryRun: false });
      expect(emailService.sendInactivityWarningEmail).toHaveBeenCalledTimes(2);
      expect(repo.getSentUserIds().size).toBe(2);
    });
  });

  describe('lastConversion lookup', () => {
    it('passes deckName derived from filename when user has a prior upload', async () => {
      repo.seedUsers([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
      const emailService = makeEmailService();
      const uploadsRepo = makeUploadRepo({
        filename: 'Biochemistry Chapter 4.html',
        created_at: new Date('2026-01-01'),
      });
      const useCase = new SendInactivityWarningsUseCase(
        repo,
        emailService,
        uploadsRepo
      );

      await useCase.execute(false);

      expect(emailService.sendInactivityWarningEmail).toHaveBeenCalledWith(
        'alice@example.com',
        expect.any(String),
        { deckName: 'Biochemistry Chapter 4' }
      );
    });

    it('passes null lastConversion when user has no prior upload', async () => {
      repo.seedUsers([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
      const emailService = makeEmailService();
      const uploadsRepo = makeUploadRepo(null);
      const useCase = new SendInactivityWarningsUseCase(
        repo,
        emailService,
        uploadsRepo
      );

      await useCase.execute(false);

      expect(emailService.sendInactivityWarningEmail).toHaveBeenCalledWith(
        'alice@example.com',
        expect.any(String),
        null
      );
    });

    it('falls back to null lastConversion when no uploadsRepo is provided', async () => {
      repo.seedUsers([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
      const emailService = makeEmailService();
      const useCase = new SendInactivityWarningsUseCase(repo, emailService);

      await useCase.execute(false);

      expect(emailService.sendInactivityWarningEmail).toHaveBeenCalledWith(
        'alice@example.com',
        expect.any(String),
        null
      );
    });
  });
});
