import type {
  EndingPass,
  IPassEndingRepository,
  PassEmailCampaign,
} from '../../data_layer/PassEndingRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import { passKindLabel } from '../passes/passKindLabel';

export interface SendPassEndingEmailsResult {
  count: number;
  renewalCount: number;
  dryRun: boolean;
}

type IsEmailSuppressed = (email: string) => Promise<boolean>;

export const PASS_ENDING_WINDOW_HOURS = 24;

export class SendPassEndingEmailsUseCase {
  constructor(
    private readonly repo: IPassEndingRepository,
    private readonly emailService: IEmailService,
    private readonly isEmailSuppressed: IsEmailSuppressed = async () => false
  ) {}

  async execute(
    dryRun: boolean,
    limit = 200
  ): Promise<SendPassEndingEmailsResult> {
    const endingTomorrow = await this.repo.getPassesEndingSoon(
      PASS_ENDING_WINDOW_HOURS,
      limit
    );
    const upForRenewal = await this.repo.getSemesterPassesUpForRenewal(limit);

    if (dryRun) {
      return {
        count: endingTomorrow.length,
        renewalCount: upForRenewal.length,
        dryRun: true,
      };
    }

    const count = await this.sendEach(
      endingTomorrow,
      'pass_ending',
      (pass, token) =>
        this.emailService.sendPassEndingEmail(
          pass.email,
          token,
          passKindLabel(pass.kind)
        )
    );
    const renewalCount = await this.sendEach(
      upForRenewal,
      'pass_renewal',
      (pass, token) =>
        this.emailService.sendSemesterRenewalEmail(
          pass.email,
          token,
          pass.expiresAt
        )
    );

    return { count, renewalCount, dryRun: false };
  }

  private async sendEach(
    passes: EndingPass[],
    campaign: PassEmailCampaign,
    send: (pass: EndingPass, token: string) => Promise<void>
  ): Promise<number> {
    let sent = 0;
    for (const pass of passes) {
      if (await this.isEmailSuppressed(pass.email)) {
        continue;
      }

      const token = crypto.randomUUID();
      const claimed = await this.repo.claimNotification(
        pass.userId,
        pass.passId,
        token,
        campaign
      );
      if (!claimed) {
        continue;
      }

      try {
        await send(pass, token);
        sent++;
      } catch (error) {
        console.error(
          `[${campaign}] failed to email user ${pass.userId}:`,
          error
        );
      }
    }
    return sent;
  }
}
