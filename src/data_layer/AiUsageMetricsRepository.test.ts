import knex from 'knex';
import { AiUsageMetricsRepository } from './AiUsageMetricsRepository';

const pg = knex({ client: 'pg' });

describe('AiUsageMetricsRepository.buildUserCostQuery generated SQL', () => {
  it('sums cost_usd from the props JSONB for one user since a date', () => {
    const repo = new AiUsageMetricsRepository(pg);
    const since = new Date('2026-05-01T00:00:00.000Z');
    const sql = repo.buildUserCostQuery(42, since).toString();
    expect(sql).toContain('from "events"');
    expect(sql).toContain('"name" = \'ai_usage_recorded\'');
    expect(sql).toContain('"user_id" = 42');
    expect(sql).toContain(
      "coalesce(sum((props->>'cost_usd')::numeric), 0) as cost_usd"
    );
  });
});
