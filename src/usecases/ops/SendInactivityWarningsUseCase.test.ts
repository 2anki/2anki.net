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
    sendInactivityWarningEmail: jest.fn().mockResolvedValue(undefined),
    sendAbandonedCheckoutRecoveryEmail: jest.fn().mockResolvedValue(undefined),
    sendPassWinbackEmail: jest.fn().mockResolvedValue(undefined),
    sendParserCanaryAlert: jest.fn().mockResolvedValue(undefined),
    sendNotionReconnectEmail: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionClaimConfirmation: jest.fn().mockResolvedValue(undefined),
    sendPassClaimConfirmation: jest.fn().mockResolvedValue(undefined),
    sendContactConfirmationEmail: jest.fn().mockResolvedValue(undefined),
    sendPriceLockInEmail: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionRecoveryEmail: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeUploadRepo(
  lastUpload: LastUpload | null = null
): jest.Mocked<IUploadRepository> {
  return {
    deleteUpload: jest.fn(),
    getUploadsByOwner: jest.fn(),
    findByIdAndOwner: jest.fn(),
    findByObjectId: jest.fn(),
    findByKey: jest.fn(),
    findAllByObjectIdAndOwner: jest.fn().mockResolvedValue([]),
    update: jest.fn(),
    getLastUploadForUser: jest.fn().mockResolvedValue(lastUpload),
    getLastReconvertibleUpload: jest.fn().mockResolvedValue(null),
    findByOwnerAndDedupeKey: jest.fn().mockResolvedValue(null),
    insertNativeDeck: jest.fn(),
    insertConvertedDeck: jest.fn(),
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
        sendInactivityWarningEmail: jest
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
