import { emailHash } from '../../lib/emailHash';
import type { ISubscriptionRecoveryNotificationsRepository } from '../../data_layer/SubscriptionRecoveryNotificationsRepository';
import type { IUnprovenPlanAccountsRepository } from '../../data_layer/UnprovenPlanAccountsRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import {
  JOB_LOCK_KEYS,
  type IJobLockRepository,
} from '../../data_layer/JobLockRepository';

const MAX_FAILURES_IN_A_ROW = 3;

// Sent once, ever. Shares the recovery table under its own key, so a recovery
// email an address once received does not stop this one.
const sentKey = (email: string): string =>
  emailHash(`confirm-email-notice:${email}`);

const EVER = new Date(0);

export interface SendConfirmEmailNoticesResult {
  count: number;
  failed: number;
  suppressed: number;
  alreadyRunning: boolean;
  dryRun: boolean;
}

const nothingSent = (dryRun: boolean): SendConfirmEmailNoticesResult => ({
  count: 0,
  failed: 0,
  suppressed: 0,
  alreadyRunning: false,
  dryRun,
});

export class SendConfirmEmailNoticesUseCase {
  constructor(
    private readonly accounts: IUnprovenPlanAccountsRepository,
    private readonly sent: ISubscriptionRecoveryNotificationsRepository,
    private readonly emailService: Pick<
      IEmailService,
      'sendConfirmEmailNotice'
    >,
    private readonly isLockedOut: (email: string) => Promise<boolean>,
    private readonly lock: IJobLockRepository
  ) {}

  private async findRecipients(): Promise<string[]> {
    const recipients: string[] = [];
    for (const email of await this.accounts.findCandidateEmails()) {
      const alreadySent = await this.sent.wasNotifiedSince(
        sentKey(email),
        EVER
      );
      if (!alreadySent && (await this.isLockedOut(email))) {
        recipients.push(email);
      }
    }
    return recipients;
  }

  // The claim goes in before the send, so a crash can only cost a notice, never
  // repeat one. A send that did not happen gives the claim back.
  private async sendAll(): Promise<SendConfirmEmailNoticesResult> {
    const result = nothingSent(false);
    let failuresInARow = 0;
    for (const email of await this.findRecipients()) {
      if (failuresInARow >= MAX_FAILURES_IN_A_ROW) {
        break;
      }
      const key = sentKey(email);
      await this.sent.recordNotified(key);
      try {
        if (await this.emailService.sendConfirmEmailNotice(email)) {
          result.count += 1;
        } else {
          await this.sent.forgetNotified(key);
          result.suppressed += 1;
        }
        failuresInARow = 0;
      } catch (error) {
        failuresInARow += 1;
        result.failed += 1;
        await this.sent.forgetNotified(key);
        console.error('[ops] confirm email notice failed', {
          email_hash: emailHash(email),
          error_name: (error as Error)?.name,
        });
      }
    }
    return result;
  }

  async execute(dryRun: boolean): Promise<SendConfirmEmailNoticesResult> {
    if (dryRun) {
      const recipients = await this.findRecipients();
      return { ...nothingSent(true), count: recipients.length };
    }
    let result = { ...nothingSent(false), alreadyRunning: true };
    await this.lock.runExclusively(
      JOB_LOCK_KEYS.confirmEmailNotices,
      async () => {
        result = await this.sendAll();
      }
    );
    return result;
  }
}
