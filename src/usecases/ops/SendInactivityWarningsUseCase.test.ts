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
    sendPassEndingEmail: vi.fn().mockResolvedValue(undefined),
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
    sendLowRatingFeedbackEmail: vi.fn().mockResolvedValue(undefined),
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

  afterEach(() => {
    vi.restoreAllMocks();
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

    it('records the send before the email goes out', async () => {
      repo.seedUsers([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
      const recordedAtSend: boolean[] = [];
      const emailService = makeEmailService({
        sendInactivityWarningEmail: vi.fn(async () => {
          recordedAtSend.push(repo.getSentUserIds().has(1));
        }),
      });
      const useCase = new SendInactivityWarningsUseCase(repo, emailService);

      await useCase.execute(false);

      expect(recordedAtSend).toEqual([true]);
    });

    it('does not warn the same user again when the batch reruns', async () => {
      repo.seedUsers([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
      const emailService = makeEmailService();
      const useCase = new SendInactivityWarningsUseCase(repo, emailService);

      await useCase.execute(false);
      const rerun = await useCase.execute(false);

      expect(rerun).toEqual({ count: 0, dryRun: false });
      expect(emailService.sendInactivityWarningEmail).toHaveBeenCalledTimes(1);
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

    it.each([
      ['a network error', 'ETIMEDOUT'],
      ['a rate limit', 429],
      ['a SendGrid outage', 503],
    ])(
      'gives the warning back after %s, so the next run warns again and no deletion clock starts',
      async (_label, code) => {
        repo.seedUsers([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
        const emailService = makeEmailService({
          sendInactivityWarningEmail: vi
            .fn()
            .mockRejectedValueOnce(
              Object.assign(new Error('send failed'), { code })
            )
            .mockResolvedValueOnce(undefined),
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const useCase = new SendInactivityWarningsUseCase(repo, emailService);

        const first = await useCase.execute(false);
        expect(first.count).toBe(0);
        expect(repo.getSentUserIds().has(1)).toBe(false);

        const second = await useCase.execute(false);
        expect(second.count).toBe(1);
        expect(repo.getSentUserIds().has(1)).toBe(true);
      }
    );

    it('gives the warning back when SendGrid refuses the address too, so nobody is deleted unwarned', async () => {
      repo.seedUsers([{ id: 1, name: 'Alice', email: 'not-an-address' }]);
      const emailService = makeEmailService({
        sendInactivityWarningEmail: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error('Bad Request'), { code: 400 })
          ),
      });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const useCase = new SendInactivityWarningsUseCase(repo, emailService);

      const result = await useCase.execute(false);

      expect(result.count).toBe(0);
      expect(repo.getSentUserIds().has(1)).toBe(false);
    });

    it('stops the run after three failed sends in a row, writing no warning for anyone', async () => {
      repo.seedUsers(
        [1, 2, 3, 4, 5].map((id) => ({
          id,
          name: `User ${id}`,
          email: `user${id}@example.com`,
        }))
      );
      const sendInactivityWarningEmail = vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('Unauthorized'), { code: 401 })
        );
      const emailService = makeEmailService({ sendInactivityWarningEmail });
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const useCase = new SendInactivityWarningsUseCase(repo, emailService);

      const result = await useCase.execute(false);

      expect(result.count).toBe(0);
      expect(sendInactivityWarningEmail).toHaveBeenCalledTimes(3);
      expect(repo.getSentUserIds().size).toBe(0);
      expect(errorLog).toHaveBeenCalledWith(
        '[inactivity] stopping the run after 3 failed sends in a row'
      );
    });

    it('does not stop the run for addresses SendGrid refuses, which say nothing about SendGrid itself', async () => {
      repo.seedUsers(
        [1, 2, 3, 4].map((id) => ({
          id,
          name: `User ${id}`,
          email: `user${id}@example.com`,
        }))
      );
      const refused = Object.assign(new Error('Bad Request'), { code: 400 });
      const sendInactivityWarningEmail = vi
        .fn()
        .mockRejectedValueOnce(refused)
        .mockRejectedValueOnce(refused)
        .mockRejectedValueOnce(refused)
        .mockResolvedValueOnce(undefined);
      const emailService = makeEmailService({ sendInactivityWarningEmail });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const useCase = new SendInactivityWarningsUseCase(repo, emailService);

      const result = await useCase.execute(false);

      expect(result.count).toBe(1);
      expect(sendInactivityWarningEmail).toHaveBeenCalledTimes(4);
      expect([...repo.getSentUserIds()]).toEqual([4]);
    });

    it('keeps going when the failures are not in a row', async () => {
      repo.seedUsers(
        [1, 2, 3, 4].map((id) => ({
          id,
          name: `User ${id}`,
          email: `user${id}@example.com`,
        }))
      );
      const failure = Object.assign(new Error('send failed'), { code: 503 });
      const sendInactivityWarningEmail = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(failure);
      const emailService = makeEmailService({ sendInactivityWarningEmail });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const useCase = new SendInactivityWarningsUseCase(repo, emailService);

      const result = await useCase.execute(false);

      expect(result.count).toBe(1);
      expect(sendInactivityWarningEmail).toHaveBeenCalledTimes(4);
      expect([...repo.getSentUserIds()]).toEqual([3]);
    });

    it('gives the warning back without sending when the last upload cannot be read', async () => {
      repo.seedUsers([{ id: 1, name: 'Alice', email: 'alice@example.com' }]);
      const uploads = makeUploadRepo();
      uploads.getLastUploadForUser.mockRejectedValueOnce(
        new Error('connection lost')
      );
      const emailService = makeEmailService();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const useCase = new SendInactivityWarningsUseCase(
        repo,
        emailService,
        uploads
      );

      const first = await useCase.execute(false);

      expect(first.count).toBe(0);
      expect(emailService.sendInactivityWarningEmail).not.toHaveBeenCalled();
      expect(repo.getSentUserIds().has(1)).toBe(false);
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
        'alice@example.com'
      );
    });

    it('keeps the run going and logs no address when giving the warning back also fails', async () => {
      repo.seedUsers([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]);
      repo.releaseSend = vi
        .fn()
        .mockRejectedValue(
          new Error(
            "delete from inactivity_emails where token = 'alice@example.com'"
          )
        );
      const emailService = makeEmailService({
        sendInactivityWarningEmail: vi
          .fn()
          .mockRejectedValueOnce(
            Object.assign(new Error('send failed'), { code: 'ECONNRESET' })
          )
          .mockResolvedValueOnce(undefined),
      });
      const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
      const useCase = new SendInactivityWarningsUseCase(repo, emailService);

      const result = await useCase.execute(false);

      expect(result.count).toBe(1);
      expect(repo.releaseSend).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        '[inactivity] failed to release the warning for user 1; it still counts toward deletion'
      );
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
        'alice@example.com'
      );
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
