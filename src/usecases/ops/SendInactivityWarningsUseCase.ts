import type { IInactivityEmailRepository } from '../../data_layer/InactivityEmailRepository';
import type { IUploadRepository } from '../../data_layer/UploadRespository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import { isTransientSendError } from '../../services/EmailService/sendWithRetry';
import path from 'node:path';

export interface SendInactivityWarningsResult {
  count: number;
  dryRun: boolean;
}

class NoOpUploadRepository implements IUploadRepository {
  deleteUpload(): Promise<number> {
    return Promise.resolve(0);
  }
  getUploadsByOwner(): Promise<never[]> {
    return Promise.resolve([]);
  }
  findByIdAndOwner(): Promise<null> {
    return Promise.resolve(null);
  }
  findByObjectId(): Promise<null> {
    return Promise.resolve(null);
  }
  findByKey(): Promise<null> {
    return Promise.resolve(null);
  }
  findAllByObjectIdAndOwner(): Promise<never[]> {
    return Promise.resolve([]);
  }
  update(): Promise<never[]> {
    return Promise.resolve([]);
  }
  getLastUploadForUser(): Promise<null> {
    return Promise.resolve(null);
  }
  getLastReconvertibleUpload(): Promise<null> {
    return Promise.resolve(null);
  }
  findByOwnerAndDedupeKey(): Promise<null> {
    return Promise.resolve(null);
  }
  insertNativeDeck(): Promise<never> {
    return Promise.reject(
      new Error('NoOpUploadRepository does not support insertNativeDeck')
    );
  }
  insertConvertedDeck(): Promise<never> {
    return Promise.reject(
      new Error('NoOpUploadRepository does not support insertConvertedDeck')
    );
  }
}

export class SendInactivityWarningsUseCase {
  private readonly uploadsRepo: IUploadRepository;

  constructor(
    private readonly repo: IInactivityEmailRepository,
    private readonly emailService: IEmailService,
    uploadsRepo?: IUploadRepository
  ) {
    this.uploadsRepo = uploadsRepo ?? new NoOpUploadRepository();
  }

  async execute(
    dryRun: boolean,
    limit = 500
  ): Promise<SendInactivityWarningsResult> {
    const users = await this.repo.getUsersToNotify(limit);

    if (dryRun) {
      return { count: users.length, dryRun: true };
    }

    let sent = 0;
    for (const user of users) {
      const token = crypto.randomUUID();
      await this.repo.recordSend(user.id, token);
      if (await this.sendWarning(user, token)) {
        sent++;
      }
    }

    return { count: sent, dryRun: false };
  }

  private async sendWarning(
    user: { id: number; email: string },
    token: string
  ): Promise<boolean> {
    let lastConversion: { deckName: string } | null;
    try {
      lastConversion = await this.lastConversionFor(user.id);
    } catch (error) {
      console.error(
        `[inactivity] failed to read the last upload for user ${user.id}:`,
        error instanceof Error ? error.message : 'unknown error'
      );
      await this.releaseWarning(user.id, token);
      return false;
    }

    try {
      await this.emailService.sendInactivityWarningEmail(
        user.email,
        token,
        lastConversion
      );
      return true;
    } catch (error) {
      console.error(`[inactivity] failed to email user ${user.id}:`, error);
      // A rejection SendGrid will repeat (an address it refuses) keeps the
      // row: retrying it every run would crowd out people who can be warned.
      if (isTransientSendError(error)) {
        await this.releaseWarning(user.id, token);
      }
      return false;
    }
  }

  private async lastConversionFor(
    userId: number
  ): Promise<{ deckName: string } | null> {
    const lastUpload = await this.uploadsRepo.getLastUploadForUser(userId);
    if (lastUpload == null) {
      return null;
    }
    return {
      deckName: path.basename(
        lastUpload.filename,
        path.extname(lastUpload.filename)
      ),
    };
  }

  // The warning row is what starts the deletion clock, so a warning that never
  // went out must not keep it: the user is picked up again on the next run. A
  // knex error inlines its bindings, so only a fixed string is logged.
  private async releaseWarning(userId: number, token: string): Promise<void> {
    try {
      await this.repo.releaseSend(token);
    } catch {
      console.error(
        `[inactivity] failed to release the warning for user ${userId}; it still counts toward deletion`
      );
    }
  }
}
