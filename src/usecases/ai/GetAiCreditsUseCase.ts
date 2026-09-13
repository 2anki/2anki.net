import {
  computeAiCreditBalance,
  AiCreditBalanceReaders,
} from '../../lib/claude/aiCredits/balance';
import { CreditWindowReset } from '../../lib/claude/aiCredits/allowance';
import { createAiCreditReaders } from '../../data_layer/createAiCreditReaders';

export { createAiCreditReaders };

export interface AiCreditsResponse {
  credits: number;
  allowance: number;
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
      return { credits: 0, allowance: 0, windowEnd: null, resets: 'month' };
    }
    return {
      credits: balance.credits,
      allowance: balance.allowance,
      windowEnd: balance.windowEnd != null ? balance.windowEnd.toISOString() : null,
      resets: balance.resets,
    };
  }
}
