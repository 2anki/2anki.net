import type { Knex } from 'knex';
import {
  computeAiCreditBalance,
  AiCreditBalanceReaders,
} from '../../lib/claude/aiCredits/balance';
import { CreditWindowReset } from '../../lib/claude/aiCredits/allowance';
import { AiCreditsRepository } from '../../data_layer/AiCreditsRepository';
import { AiCreditGrantsRepository } from '../../data_layer/AiCreditGrantsRepository';
import { AiUsageMetricsRepository } from '../../data_layer/AiUsageMetricsRepository';

export interface AiCreditsResponse {
  credits: number;
  allowance: number;
  windowEnd: string | null;
  resets: CreditWindowReset;
}

export function createAiCreditReaders(db: Knex): AiCreditBalanceReaders {
  const plans = new AiCreditsRepository(db);
  const grants = new AiCreditGrantsRepository(db);
  const usage = new AiUsageMetricsRepository(db);
  return {
    getPlanInputs: (userId, now) => plans.getPlanInputs(userId, now),
    sumActiveCredits: (userId, now) => grants.sumActiveCredits(userId, now),
    userCostSince: (userId, since) => usage.userCostSince(userId, since),
  };
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
