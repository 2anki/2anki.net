import type { Knex } from 'knex';
import { AiCreditBalanceReaders } from '../lib/claude/aiCredits/balance';
import { AiCreditsRepository } from './AiCreditsRepository';
import { AiCreditGrantsRepository } from './AiCreditGrantsRepository';
import { AiUsageMetricsRepository } from './AiUsageMetricsRepository';

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
