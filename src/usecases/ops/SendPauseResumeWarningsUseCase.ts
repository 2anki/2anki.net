import type {
  IPauseResumeWarningRepository,
  PausedSubscriptionRow,
} from '../../data_layer/PauseResumeWarningRepository';
import type { IEmailService } from '../../services/EmailService/EmailService';

const WARNING_WINDOW_DAYS = 3;

interface ParsedPause {
  resumesAtSeconds: number;
  amountCents: number | null;
  currency: string;
}

function parsePayload(payload: unknown): ParsedPause | null {
  let parsed: unknown = payload;
  if (typeof payload === 'string') {
    try {
      parsed = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  const subscription = parsed as {
    pause_collection?: { resumes_at?: number | null } | null;
    plan?: { amount?: number | null; currency?: string | null } | null;
  } | null;
  const resumesAt = subscription?.pause_collection?.resumes_at;
  if (resumesAt == null) {
    return null;
  }
  return {
    resumesAtSeconds: resumesAt,
    amountCents: subscription?.plan?.amount ?? null,
    currency: subscription?.plan?.currency ?? 'usd',
  };
}

export function formatAmount(
  amountCents: number | null,
  currency: string
): string {
  if (amountCents == null) {
    return 'your regular price';
  }
  const major = (amountCents / 100).toFixed(2);
  const symbol = currency.toLowerCase() === 'eur' ? '€' : '$';
  return `${symbol}${major}`;
}

export class SendPauseResumeWarningsUseCase {
  constructor(
    private readonly repository: IPauseResumeWarningRepository,
    private readonly emailService: IEmailService
  ) {}

  async execute(now: Date = new Date()): Promise<{ count: number }> {
    const fromSeconds = Math.floor(now.getTime() / 1000);
    const toSeconds = fromSeconds + WARNING_WINDOW_DAYS * 24 * 60 * 60;

    const rows = await this.repository.findPausedResumingBetween(
      fromSeconds,
      toSeconds
    );

    let count = 0;
    for (const row of rows) {
      const sent = await this.sendWarning(row);
      if (sent) count += 1;
    }
    return { count };
  }

  private async sendWarning(row: PausedSubscriptionRow): Promise<boolean> {
    const pause = parsePayload(row.payload);
    if (pause == null) {
      return false;
    }
    const resumesAt = new Date(pause.resumesAtSeconds * 1000);
    if (!(await this.repository.claimNotice(row.email, resumesAt))) {
      return false;
    }

    const recipient = row.linked_email ?? row.email;
    try {
      await this.emailService.sendSubscriptionResumingSoonEmail(
        recipient,
        resumesAt,
        formatAmount(pause.amountCents, pause.currency)
      );
      return true;
    } catch (error) {
      await this.repository.releaseNotice(row.email, resumesAt);
      console.error(
        '[pause-resume-warnings] failed to send a warning:',
        error instanceof Error ? error.message : 'unknown error'
      );
      return false;
    }
  }
}
