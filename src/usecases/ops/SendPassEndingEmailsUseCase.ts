import type { IPassEndingRepository } from '../../data_layer/PassEndingRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';
import { passKindLabel } from '../passes/passKindLabel';

export interface SendPassEndingEmailsResult {
  count: number;
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
    const passes = await this.repo.getPassesEndingSoon(
      PASS_ENDING_WINDOW_HOURS,
      limit
    );

    if (dryRun) {
      return { count: passes.length, dryRun: true };
    }

    let sent = 0;
    for (const pass of passes) {
      if (await this.isEmailSuppressed(pass.email)) {
        continue;
      }

      const token = crypto.randomUUID();
      const claimed = await this.repo.claimNotification(
        pass.userId,
        pass.passId,
        token
      );
      if (!claimed) {
        continue;
      }

      try {
        await this.emailService.sendPassEndingEmail(
          pass.email,
          token,
          passKindLabel(pass.kind)
        );
        sent++;
      } catch (error) {
        console.error(
          `[pass-ending] failed to email user ${pass.userId}:`,
          error
        );
      }
    }

    return { count: sent, dryRun: false };
  }
}
