import type { IInactivityEmailRepository } from '../../data_layer/InactivityEmailRepository';
import type { IUploadRepository } from '../../data_layer/UploadRespository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import path from 'node:path';

const MAX_FAILURES_IN_A_ROW = 3;

type SendOutcome = 'sent' | 'address_refused' | 'failed';

// SendGrid answers 400 for a recipient it will not take: that is about one
// address, so it must not count toward stopping the run. A revoked key (401),
// an unverified sender (403), a rate limit or an outage is about SendGrid.
function isAddressRefusal(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 400;
}

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
    let failuresInARow = 0;
    for (const user of users) {
      const token = crypto.randomUUID();
      await this.repo.recordSend(user.id, token);
      const outcome = await this.sendWarning(user, token);
      if (outcome === 'sent') {
        sent++;
        failuresInARow = 0;
        continue;
      }
      if (outcome === 'address_refused') {
        continue;
      }
      failuresInARow++;
      // Several failures in a row point at SendGrid or the key, not at one
      // address: stop rather than churn through the rest of the batch.
      if (failuresInARow >= MAX_FAILURES_IN_A_ROW) {
        console.error(
          `[inactivity] stopping the run after ${MAX_FAILURES_IN_A_ROW} failed sends in a row`
        );
        break;
      }
    }

    return { count: sent, dryRun: false };
  }

  private async sendWarning(
    user: { id: number; email: string },
    token: string
  ): Promise<SendOutcome> {
    let lastConversion: { deckName: string } | null;
    try {
      lastConversion = await this.lastConversionFor(user.id);
    } catch (error) {
      console.error(
        `[inactivity] failed to read the last upload for user ${user.id}:`,
        error instanceof Error ? error.message : 'unknown error'
      );
      await this.releaseWarning(user.id, token);
      return 'failed';
    }

    try {
      await this.emailService.sendInactivityWarningEmail(
        user.email,
        token,
        lastConversion
      );
      return 'sent';
    } catch (error) {
      console.error(`[inactivity] failed to email user ${user.id}:`, error);
      await this.releaseWarning(user.id, token);
      return isAddressRefusal(error) ? 'address_refused' : 'failed';
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
