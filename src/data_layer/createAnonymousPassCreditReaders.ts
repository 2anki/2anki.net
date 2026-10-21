import type { Knex } from 'knex';
import { AnonymousPassBalanceReaders } from '../lib/claude/aiCredits/anonymousPassBalance';
import { AnonymousPassRepository } from './AnonymousPassRepository';
import { AiUsageMetricsRepository } from './AiUsageMetricsRepository';

export function createAnonymousPassCreditReaders(
  db: Knex
): AnonymousPassBalanceReaders {
  const passes = new AnonymousPassRepository(db);
  const usage = new AiUsageMetricsRepository(db);
  return {
    getPass: async (anonymousPassId) => {
      const pass = await passes.findById(anonymousPassId);
      return pass ? { kind: pass.kind, expiresAt: pass.expires_at } : null;
    },
    passCostSince: (anonymousPassId, since) =>
      usage.anonymousPassCostSince(anonymousPassId, since),
  };
}
