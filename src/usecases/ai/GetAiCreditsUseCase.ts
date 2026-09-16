import {
  computeAiCreditBalance,
  AiCreditBalanceReaders,
} from '../../lib/claude/aiCredits/balance';
import { CreditWindowReset } from '../../lib/claude/aiCredits/allowance';

export { createAiCreditReaders } from '../../data_layer/createAiCreditReaders';

export interface AiCreditsResponse {
  credits: number;
  used: number;
  allowance: number;
  usable: boolean;
  windowEnd: string | null;
  resets: CreditWindowReset;
}

export class GetAiCreditsUseCase {
  constructor(private readonly readers: AiCreditBalanceReaders) {}

  async execute(
    userId: number,
    now: Date = new Date()
  ): Promise<AiCreditsResponse> {
    const balance = await computeAiCreditBalance(userId, now, this.readers);
    if (balance == null) {
      return {
        credits: 0,
        used: 0,
        allowance: 0,
        usable: false,
        windowEnd: null,
        resets: 'month',
      };
    }
    return {
      credits: balance.credits,
      used: balance.spent,
      allowance: balance.allowance,
      usable: balance.allowance > 0,
      windowEnd:
        balance.windowEnd != null ? balance.windowEnd.toISOString() : null,
      resets: balance.resets,
    };
  }
}
