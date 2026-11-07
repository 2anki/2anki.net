import { emailHash } from '../../lib/emailHash';
import type { ISubscriptionRecoveryNotificationsRepository } from '../../data_layer/SubscriptionRecoveryNotificationsRepository';
import type { IUnprovenPlanAccountsRepository } from '../../data_layer/UnprovenPlanAccountsRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';

const MAX_FAILURES_IN_A_ROW = 3;

// Sent once, ever. Shares the recovery table under its own key, so a recovery
// email an address once received does not stop this one.
const sentKey = (email: string): string =>
  emailHash(`confirm-email-notice:${email}`);

const EVER = new Date(0);

export interface SendConfirmEmailNoticesResult {
  count: number;
  dryRun: boolean;
}

export class SendConfirmEmailNoticesUseCase {
  constructor(
    private readonly accounts: IUnprovenPlanAccountsRepository,
    private readonly sent: ISubscriptionRecoveryNotificationsRepository,
    private readonly emailService: Pick<
      IEmailService,
      'sendConfirmEmailNotice'
    >,
    private readonly isLockedOut: (email: string) => Promise<boolean>
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

  async execute(dryRun: boolean): Promise<SendConfirmEmailNoticesResult> {
    const recipients = await this.findRecipients();
    if (dryRun) {
      return { count: recipients.length, dryRun: true };
    }

    let count = 0;
    let failuresInARow = 0;
    for (const email of recipients) {
      if (failuresInARow >= MAX_FAILURES_IN_A_ROW) {
        break;
      }
      try {
        await this.emailService.sendConfirmEmailNotice(email);
        await this.sent.recordNotified(sentKey(email));
        count += 1;
        failuresInARow = 0;
      } catch (error) {
        failuresInARow += 1;
        console.error('[ops] confirm email notice failed', {
          email_hash: emailHash(email),
          error_name: (error as Error)?.name,
        });
      }
    }
    return { count, dryRun: false };
  }
}
